import { apiStats, getClearinghouseState, Priority } from './api';
import { loadSeeds, type SeedSource } from './leaderboard';
import { Observable, sleep } from './observable';
import { openTimes } from './openTimes';
import { parseClearinghouse, toLive } from './positions';
import { settings } from './settings';
import { load, save } from './storage';
import type { LivePosition, Position, SeedAccount, WalletSnapshot } from './types';

/** Wallets whose largest position is below this are not kept in memory. */
export const STORE_FLOOR_USD = 100_000;
const CONCURRENCY = 4;
const MAX_PERSISTED_WALLETS = 1000;
const MAX_DISCOVERED = 3000;
/** Minimum time between the starts of two full passes. */
const MIN_PASS_MS = 60_000;

export interface DiscoveredInfo {
  firstSeen: number;
  lastSeen: number;
  maxUsd: number;
  source: 'live' | 'manual';
}

export interface NewWhaleEvent {
  address: string;
  position: Position;
  snapshot: WalletSnapshot;
}

export type ScannerStatus = 'idle' | 'seeding' | 'scanning' | 'paused' | 'error';

const maxPositionUsd = (w: WalletSnapshot) => w.positions.reduce((m, p) => Math.max(m, p.positionValue), 0);

/**
 * Background engine that walks the leaderboard calling `clearinghouseState`
 * for each account. Cold accounts are visited once per pass, while wallets
 * already holding jumbo positions ("hot") are refreshed every
 * `hotRefreshSec`. Addresses found by the live trade feed jump the queue.
 */
class Scanner extends Observable {
  status: ScannerStatus = 'idle';
  statusMsg = '';
  seed: { source: SeedSource; generatedAt: number; count: number } | null = null;
  seedMap = new Map<string, SeedAccount>();
  wallets = new Map<string, WalletSnapshot>();
  discovered: Map<string, DiscoveredInfo>;
  pass = { n: 0, total: 0, done: 0, startedAt: 0, finishedAt: 0, lastDurationMs: 0 };
  scannedTotal = 0;
  errors = 0;
  restoredAt = 0;

  private queue: string[] = [];
  private priorityQueue: string[] = [];
  private lastScanned = new Map<string, number>();
  private inFlight = new Set<string>();
  private running = false;
  private workers = 0;
  private pickHot = false;
  private scanTimes: number[] = [];
  private dirty = false;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private newWhaleListeners = new Set<(e: NewWhaleEvent) => void>();
  private extraProvider: () => string[] = () => [];

  constructor() {
    super(300);
    const saved = load<{ savedAt: number; wallets: WalletSnapshot[] } | null>('scan', null);
    if (saved?.wallets) {
      for (const w of saved.wallets) this.wallets.set(w.address, w);
      this.restoredAt = saved.savedAt;
    }
    this.discovered = new Map(load<[string, DiscoveredInfo][]>('discovered', []));
  }

  /** Addresses (e.g. the watchlist) that every pass should include. */
  setExtraProvider(fn: () => string[]): void {
    this.extraProvider = fn;
  }

  onNewWhale(cb: (e: NewWhaleEvent) => void): () => void {
    this.newWhaleListeners.add(cb);
    return () => this.newWhaleListeners.delete(cb);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (!this.persistTimer) this.persistTimer = setInterval(() => this.persist(), 20_000);
    if (!this.seed) await this.loadSeed(false);
    if (!this.running) return;
    if (!this.queue.length || this.pass.done >= this.queue.length) this.buildPass();
    this.status = 'scanning';
    this.emit(true);
    while (this.workers < CONCURRENCY) void this.worker();
  }

  pause(): void {
    this.running = false;
    this.status = 'paused';
    this.emit(true);
  }

  get isRunning(): boolean {
    return this.running;
  }

  async loadSeed(forceLive: boolean): Promise<void> {
    this.status = 'seeding';
    this.statusMsg = 'Memuat daftar akun dari leaderboard Hyperliquid…';
    this.emit(true);
    try {
      const res = await loadSeeds(forceLive, (m) => {
        this.statusMsg = m;
        this.emit();
      });
      this.seedMap = new Map(res.accounts.map((a) => [a.address, a]));
      this.seed = { source: res.source, generatedAt: res.generatedAt, count: res.accounts.length };
      this.statusMsg = '';
    } catch (e) {
      this.statusMsg = `${(e as Error).message} Scanner tetap memindai watchlist & whale dari live feed.`;
      this.seed = this.seed ?? { source: 'stale', generatedAt: 0, count: 0 };
    }
    this.status = this.running ? 'scanning' : 'paused';
    if (forceLive) this.buildPass();
    this.emit(true);
  }

  /** Start a fresh pass over the leaderboard (e.g. after changing settings). */
  restartPass(): void {
    this.buildPass();
    this.emit(true);
  }

  /** Scan an address as soon as possible and include it in future passes. */
  enqueue(address: string, source: DiscoveredInfo['source'] = 'live', usd = 0): void {
    const a = address.toLowerCase();
    const now = Date.now();
    const d = this.discovered.get(a);
    if (d) {
      d.lastSeen = now;
      d.maxUsd = Math.max(d.maxUsd, usd);
    } else {
      this.discovered.set(a, { firstSeen: now, lastSeen: now, maxUsd: usd, source });
      if (this.discovered.size > MAX_DISCOVERED) {
        const oldest = [...this.discovered].sort((x, y) => x[1].lastSeen - y[1].lastSeen)[0];
        this.discovered.delete(oldest[0]);
      }
    }
    this.dirty = true;
    const last = this.lastScanned.get(a) ?? 0;
    if (now - last > 10_000 && !this.priorityQueue.includes(a) && !this.inFlight.has(a)) this.priorityQueue.push(a);
  }

  /** Scans per minute over the last minute. */
  get scanRate(): number {
    const cutoff = Date.now() - 60_000;
    while (this.scanTimes.length && this.scanTimes[0] < cutoff) this.scanTimes.shift();
    return this.scanTimes.length;
  }

  lastScannedAt(address: string): number | undefined {
    return this.lastScanned.get(address);
  }

  /** All positions in memory re-priced with live mids, filtered by notional. */
  livePositions(mids: Map<string, number>, minUsd: number): LivePosition[] {
    const out: LivePosition[] = [];
    for (const w of this.wallets.values()) {
      for (const p of w.positions) {
        const lp = toLive(p, w, mids);
        if (lp.notional >= minUsd) out.push(lp);
      }
    }
    return out;
  }

  private buildPass(): void {
    const s = settings.value;
    const seeds = [...this.seedMap.values()]
      .filter((a) => a.accountValue >= s.minAccountValue)
      .sort((a, b) => b.accountValue - a.accountValue)
      .slice(0, s.scanLimit)
      .map((a) => a.address);
    const set = new Set(seeds);
    for (const a of this.extraProvider()) set.add(a.toLowerCase());
    for (const a of this.discovered.keys()) set.add(a);
    for (const a of this.wallets.keys()) set.add(a);
    this.queue = [...set];
    this.pass = {
      n: this.pass.n + 1,
      total: this.queue.length,
      done: 0,
      startedAt: Date.now(),
      finishedAt: 0,
      lastDurationMs: this.pass.lastDurationMs,
    };
  }

  private async worker(): Promise<void> {
    this.workers++;
    try {
      while (this.running) {
        const addr = this.next();
        if (!addr) {
          await sleep(1000);
          continue;
        }
        await this.scanOne(addr);
      }
    } finally {
      this.workers--;
    }
  }

  private next(): string | null {
    const now = Date.now();
    while (this.priorityQueue.length) {
      const a = this.priorityQueue.shift()!;
      if (!this.inFlight.has(a)) return a;
    }
    // Alternate hot refreshes and cold discovery so neither starves.
    this.pickHot = !this.pickHot;
    if (this.pickHot) {
      const hot = this.nextHot(now);
      if (hot) return hot;
    }
    return this.nextCold(now) ?? this.nextHot(now);
  }

  private nextHot(now: number): string | null {
    const s = settings.value;
    const floor = Math.min(s.minPositionUsd, 1_000_000);
    const maxAge = s.hotRefreshSec * 1000;
    let best: string | null = null;
    let bestAt = Infinity;
    for (const w of this.wallets.values()) {
      if (this.inFlight.has(w.address) || maxPositionUsd(w) < floor) continue;
      const at = this.lastScanned.get(w.address) ?? 0;
      if (now - at > maxAge && at < bestAt) {
        best = w.address;
        bestAt = at;
      }
    }
    return best;
  }

  private nextCold(now: number): string | null {
    let rebuilt = false;
    for (;;) {
      if (this.pass.done >= this.queue.length) {
        if (!this.pass.finishedAt) {
          this.pass.finishedAt = now;
          this.pass.lastDurationMs = now - this.pass.startedAt;
        }
        // Rebuild at most once per call and once per MIN_PASS_MS: with a tiny
        // universe every address can be "recently scanned", and looping here
        // would spin forever.
        if (rebuilt || !settings.value.continuousScan || now - this.pass.startedAt < MIN_PASS_MS) return null;
        this.buildPass();
        rebuilt = true;
        if (!this.queue.length) return null;
      }
      const a = this.queue[this.pass.done++];
      if (this.inFlight.has(a)) continue;
      // Already refreshed recently by the hot/priority path.
      if (now - (this.lastScanned.get(a) ?? 0) < 30_000) continue;
      return a;
    }
  }

  private async scanOne(addr: string): Promise<void> {
    this.inFlight.add(addr);
    try {
      const st = await getClearinghouseState(addr, Priority.Scan);
      this.scannedTotal++;
      this.scanTimes.push(Date.now());
      this.ingest(parseClearinghouse(addr, st));
    } catch {
      this.errors++;
      this.statusMsg = apiStats.lastError;
    } finally {
      this.inFlight.delete(addr);
      this.emit();
    }
  }

  /** Record a fresh snapshot (from the scan loop or the watchlist poller). */
  ingest(snap: WalletSnapshot): void {
    const addr = snap.address;
    const prevScan = this.lastScanned.get(addr);
    const prev = this.wallets.get(addr);
    openTimes.onSnapshot(prev, snap);
    this.lastScanned.set(addr, Date.now());
    if (maxPositionUsd(snap) >= STORE_FLOOR_USD) this.wallets.set(addr, snap);
    else this.wallets.delete(addr);
    this.dirty = true;
    // Only compare against a state observed in this session.
    if (prevScan !== undefined) this.detectNewWhales(prev, snap);
    this.emit();
  }

  private detectNewWhales(prev: WalletSnapshot | undefined, snap: WalletSnapshot): void {
    // Fire from the smaller of the two thresholds; each listener applies its own minimum.
    const min = Math.min(settings.value.alertNewWhaleMinUsd, settings.value.minPositionUsd);
    for (const p of snap.positions) {
      if (p.positionValue < min) continue;
      const before = prev?.positions.find((q) => q.coin === p.coin && q.side === p.side);
      if (before && before.positionValue >= min * 0.5) continue;
      for (const cb of this.newWhaleListeners) cb({ address: snap.address, position: p, snapshot: snap });
    }
  }

  /** Save results now (also runs every 20s while anything changed). */
  persist(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const wallets = [...this.wallets.values()]
      .sort((a, b) => maxPositionUsd(b) - maxPositionUsd(a))
      .slice(0, MAX_PERSISTED_WALLETS);
    save('scan', { savedAt: Date.now(), wallets });
    save('discovered', [...this.discovered]);
  }
}

export const scanner = new Scanner();
