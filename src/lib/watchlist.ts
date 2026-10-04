import { diffSnapshots, type AlertEvent } from './alerts';
import { getClearinghouseState, Priority } from './api';
import { fmtPx, fmtSize, fmtUsd, isAddress, num, shortAddr } from './format';
import { live } from './live';
import { notifier } from './notify';
import { Observable } from './observable';
import { parseClearinghouse } from './positions';
import { scanner } from './scanner';
import { settings } from './settings';
import { load, save } from './storage';
import type { HLFill, WalletSnapshot } from './types';
import { socket } from './ws';

export interface WatchEntry {
  address: string;
  label: string;
  addedAt: number;
}

export interface AlertItem extends AlertEvent {
  id: string;
  time: number;
  address: string;
  label: string;
}

/** Hyperliquid allows user-specific websocket streams for at most 10 users per IP. */
export const MAX_REALTIME_USERS = 10;
const MAX_ALERTS = 300;
const FILL_IDLE_MS = 2000;
/** Position-change alerts are skipped when a fill alert for the same coin just fired. */
const FILL_SUPPRESS_MS = 90_000;

interface FillBucket {
  user: string;
  coin: string;
  dir: string;
  size: number;
  notional: number;
  closedPnl: number;
  fills: number;
  touchedAt: number;
}

class Watchlist extends Observable {
  entries: WatchEntry[] = load<WatchEntry[]>('watchlist', []);
  snapshots = new Map<string, WalletSnapshot>();
  errors = new Map<string, string>();
  alerts: AlertItem[] = load<AlertItem[]>('alerts', []);
  unread = 0;

  private lastPolled = new Map<string, number>();
  private inFlight = new Set<string>();
  private liqArmed = new Map<string, Map<string, boolean>>();
  private fillBuckets = new Map<string, FillBucket>();
  private recentFillAlert = new Map<string, number>();
  private started = false;

  constructor() {
    super(300);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    scanner.setExtraProvider(() => this.entries.map((e) => e.address));
    setInterval(() => this.tick(), 2000);
    setInterval(() => this.flushFills(), 500);
    socket.on('userFills', (d) => this.onUserFills(d as { isSnapshot?: boolean; user: string; fills: HLFill[] }));
    this.syncRealtime();

    scanner.onNewWhale(({ address, position: p }) => {
      if (!settings.value.alertNewWhale || this.has(address)) return;
      const seed = scanner.seedMap.get(address);
      this.pushAlert({
        kind: 'whale',
        coin: p.coin,
        severity: 'warn',
        address,
        label: seed?.displayName ?? '',
        title: `WHALE BARU: ${p.side === 'long' ? 'LONG' : 'SHORT'} ${p.coin} ${fmtUsd(p.positionValue)}`,
        body: `${shortAddr(address)} · entry ${fmtPx(p.entryPx)} · ${p.leverage}x`,
      });
    });

    // Watched wallets beyond the realtime limit still get alerts from the public trade stream.
    live.onBigTrade((t) => {
      const idx = this.entries.findIndex((e) => e.address === t.taker);
      if (idx < MAX_REALTIME_USERS || !settings.value.alertTrades) return;
      const e = this.entries[idx];
      this.pushAlert({
        kind: 'bigtrade',
        coin: t.coin,
        severity: 'info',
        address: e.address,
        label: e.label,
        title: `${t.side === 'buy' ? 'BELI' : 'JUAL'} ${t.coin} ${fmtUsd(t.notional)}`,
        body: `${fmtSize(t.size)} ${t.coin} @ ${fmtPx(t.avgPx)}`,
      });
      this.lastPolled.set(e.address, 0);
    });
  }

  has(address: string): boolean {
    const a = address.toLowerCase();
    return this.entries.some((e) => e.address === a);
  }

  get(address: string): WatchEntry | undefined {
    const a = address.toLowerCase();
    return this.entries.find((e) => e.address === a);
  }

  labelOf(address: string): string {
    return this.get(address)?.label || scanner.seedMap.get(address.toLowerCase())?.displayName || '';
  }

  add(address: string, label = ''): void {
    const a = address.trim().toLowerCase();
    if (!isAddress(a) || this.has(a)) return;
    this.entries = [...this.entries, { address: a, label: label.trim(), addedAt: Date.now() }];
    this.persist();
    scanner.enqueue(a, 'manual');
    this.lastPolled.set(a, 0);
  }

  remove(address: string): void {
    const a = address.toLowerCase();
    this.entries = this.entries.filter((e) => e.address !== a);
    this.snapshots.delete(a);
    this.liqArmed.delete(a);
    this.persist();
  }

  rename(address: string, label: string): void {
    const a = address.toLowerCase();
    this.entries = this.entries.map((e) => (e.address === a ? { ...e, label: label.trim() } : e));
    this.persist();
  }

  move(address: string, delta: number): void {
    const i = this.entries.findIndex((e) => e.address === address);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.entries.length) return;
    const next = [...this.entries];
    [next[i], next[j]] = [next[j], next[i]];
    this.entries = next;
    this.persist();
  }

  exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  /** Accepts our export format, or plain text with one address (+ optional label) per line. */
  importText(text: string): number {
    let added = 0;
    let items: { address: string; label?: string }[] = [];
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) items = parsed.filter((x) => typeof x?.address === 'string');
    } catch {
      items = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [address, ...rest] = l.split(/[\s,;]+/);
          return { address, label: rest.join(' ') };
        });
    }
    for (const it of items) {
      if (isAddress(it.address) && !this.has(it.address)) {
        this.add(it.address, it.label ?? '');
        added++;
      }
    }
    return added;
  }

  markRead(): void {
    if (!this.unread) return;
    this.unread = 0;
    this.emit(true);
  }

  clearAlerts(): void {
    this.alerts = [];
    this.unread = 0;
    save('alerts', this.alerts);
    this.emit(true);
  }

  refreshNow(address?: string): void {
    for (const e of this.entries) if (!address || e.address === address) this.lastPolled.set(e.address, 0);
    this.tick();
  }

  isRealtime(address: string): boolean {
    const i = this.entries.findIndex((e) => e.address === address);
    return i >= 0 && i < MAX_REALTIME_USERS;
  }

  pushAlert(a: Omit<AlertItem, 'id' | 'time'>): void {
    const item: AlertItem = { ...a, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, time: Date.now() };
    this.alerts = [item, ...this.alerts].slice(0, MAX_ALERTS);
    this.unread++;
    save('alerts', this.alerts);
    const who = a.label || shortAddr(a.address);
    notifier.push({ title: `${who}: ${a.title}`, body: a.body, severity: a.severity, href: `#/wallet/${a.address}` });
    this.emit();
  }

  private persist(): void {
    save('watchlist', this.entries);
    this.syncRealtime();
    this.emit(true);
  }

  private syncRealtime(): void {
    socket.syncType(
      'userFills',
      this.entries.slice(0, MAX_REALTIME_USERS).map((e) => ({ type: 'userFills', user: e.address })),
    );
  }

  private tick(): void {
    const now = Date.now();
    const every = settings.value.watchPollSec * 1000;
    for (const e of this.entries) {
      if (this.inFlight.size >= 3) break;
      if (this.inFlight.has(e.address)) continue;
      if (now - (this.lastPolled.get(e.address) ?? 0) < every) continue;
      void this.poll(e);
    }
  }

  private async poll(e: WatchEntry): Promise<void> {
    this.inFlight.add(e.address);
    this.lastPolled.set(e.address, Date.now());
    try {
      const snap = parseClearinghouse(e.address, await getClearinghouseState(e.address, Priority.Watch));
      const prev = this.snapshots.get(e.address);
      this.snapshots.set(e.address, snap);
      this.errors.delete(e.address);
      scanner.ingest(snap);
      if (prev && this.has(e.address)) this.alertDiff(e, prev, snap);
    } catch (err) {
      this.errors.set(e.address, (err as Error).message);
    } finally {
      this.inFlight.delete(e.address);
      this.emit();
    }
  }

  private alertDiff(e: WatchEntry, prev: WalletSnapshot, snap: WalletSnapshot): void {
    const s = settings.value;
    let armed = this.liqArmed.get(e.address);
    if (!armed) this.liqArmed.set(e.address, (armed = new Map()));
    const events = diffSnapshots(prev, snap, { sizeChangePct: s.alertSizeChangePct, liqPct: s.alertLiqPct }, armed);
    const now = Date.now();
    for (const ev of events) {
      if (ev.kind !== 'liq' && !s.alertPositionChanges) continue;
      const recentFill = now - (this.recentFillAlert.get(`${e.address}|${ev.coin}`) ?? 0) < FILL_SUPPRESS_MS;
      if (recentFill && ev.kind !== 'liq' && ev.kind !== 'flip') continue;
      this.pushAlert({ ...ev, address: e.address, label: e.label });
    }
  }

  private onUserFills(d: { isSnapshot?: boolean; user: string; fills: HLFill[] } | undefined): void {
    if (!d || d.isSnapshot || !Array.isArray(d.fills)) return;
    const user = d.user?.toLowerCase();
    if (!user || !this.has(user)) return;
    const now = Date.now();
    for (const f of d.fills) {
      const key = `${user}|${f.coin}|${f.dir}`;
      let b = this.fillBuckets.get(key);
      if (!b) {
        b = { user, coin: f.coin, dir: f.dir, size: 0, notional: 0, closedPnl: 0, fills: 0, touchedAt: now };
        this.fillBuckets.set(key, b);
      }
      const sz = num(f.sz);
      b.size += sz;
      b.notional += sz * num(f.px);
      b.closedPnl += num(f.closedPnl);
      b.fills++;
      b.touchedAt = now;
    }
    this.lastPolled.set(user, 0);
  }

  private flushFills(): void {
    const now = Date.now();
    for (const [k, b] of this.fillBuckets) {
      if (now - b.touchedAt < FILL_IDLE_MS) continue;
      this.fillBuckets.delete(k);
      if (!settings.value.alertTrades) continue;
      const e = this.get(b.user);
      if (!e) continue;
      this.recentFillAlert.set(`${b.user}|${b.coin}`, now);
      const avg = b.size > 0 ? b.notional / b.size : 0;
      const pnl = b.closedPnl !== 0 ? ` · PnL ${fmtUsd(b.closedPnl, { sign: true })}` : '';
      const liquidated = /liquidat/i.test(b.dir);
      this.pushAlert({
        kind: 'trade',
        coin: b.coin,
        severity: liquidated ? 'danger' : 'info',
        address: b.user,
        label: e.label,
        title: `${translateDir(b.dir)} ${b.coin} ${fmtUsd(b.notional)}`,
        body: `${fmtSize(b.size)} ${b.coin} @ ${fmtPx(avg)} (${b.fills} fill)${pnl}`,
      });
    }
  }
}

/** Hyperliquid fill directions → Indonesian. */
export function translateDir(dir: string): string {
  const map: Record<string, string> = {
    'Open Long': 'Buka Long',
    'Open Short': 'Buka Short',
    'Close Long': 'Tutup Long',
    'Close Short': 'Tutup Short',
    'Long > Short': 'Balik Long → Short',
    'Short > Long': 'Balik Short → Long',
    Buy: 'Beli',
    Sell: 'Jual',
  };
  if (map[dir]) return map[dir];
  if (/liquidat/i.test(dir)) return `Likuidasi (${dir})`;
  return dir;
}

export const watchlist = new Watchlist();
