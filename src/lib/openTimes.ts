import { USER_FILLS_CAP } from './api';
import { fillsService } from './fills';
import { num } from './format';
import { Observable } from './observable';
import { load, save } from './storage';
import type { HLFill, Side, WalletSnapshot } from './types';

/**
 * When was each whale position opened? Hyperliquid's position data has no
 * open time, so it is reconstructed from the wallet's fills: the most recent
 * fill that took the position from flat (or the other side) to its current
 * side is the opening fill.
 */
export interface OpenInfo {
  side: Side;
  /** Time of the fill that opened the current position. */
  openedAt: number | null;
  /** Set when the position predates every fill the API returns: it opened before this time. */
  before: number | null;
  /** Most recent fill on this coin (last add/reduce). */
  lastFillAt: number | null;
  checkedAt: number;
}

const EPS = 1e-9;

export function findOpenTime(fills: HLFill[], coin: string, szi: number): Omit<OpenInfo, 'side' | 'checkedAt'> {
  const sign = Math.sign(szi);
  const mine = fills.filter((f) => f.coin === coin).sort((a, b) => b.time - a.time);
  const lastFillAt = mine[0]?.time ?? null;
  for (const f of mine) {
    const start = num(f.startPosition);
    const after = start + (f.side === 'B' ? 1 : -1) * num(f.sz);
    if (start * sign <= EPS && after * sign > EPS) return { openedAt: f.time, before: null, lastFillAt };
  }
  // Not found. If the API returned its full window, the position is older than that window.
  if (fills.length >= USER_FILLS_CAP) {
    const oldest = fills.reduce((m, f) => Math.min(m, f.time), Infinity);
    return { openedAt: null, before: Number.isFinite(oldest) ? oldest : null, lastFillAt };
  }
  return { openedAt: null, before: null, lastFillAt };
}

const MAX_ENTRIES = 4000;
/** Re-check an unchanged position at most this often (it may have been closed and reopened between scans). */
const STALE_MS = 6 * 60 * 60_000;

const key = (address: string, coin: string) => `${address}|${coin}`;

class OpenTimes extends Observable {
  private cache = new Map<string, OpenInfo>(load<[string, OpenInfo][]>('opentimes', []));
  private positionsOf: (address: string) => WalletSnapshot | undefined = () => undefined;

  constructor() {
    super(400);
    fillsService.onFills((address, fills) => {
      const snap = this.positionsOf(address);
      if (snap) this.ingest(address, fills, snap);
    });
    fillsService.subscribe(() => this.emit());
  }

  /** Where to look up a wallet's current positions (the scanner). */
  setSource(fn: (address: string) => WalletSnapshot | undefined): void {
    this.positionsOf = fn;
  }

  get(address: string, coin: string, side: Side): OpenInfo | undefined {
    const info = this.cache.get(key(address, coin));
    return info && info.side === side ? info : undefined;
  }

  isPending(address: string): boolean {
    return fillsService.isPending(address);
  }

  /** Ask for open times of a wallet's positions; cheap to call repeatedly. */
  request(address: string): void {
    const snap = this.positionsOf(address);
    if (!snap?.positions.length) return;
    const now = Date.now();
    const missing = snap.positions.some((p) => {
      const info = this.get(address, p.coin, p.side);
      return !info || now - info.checkedAt > STALE_MS;
    });
    if (missing) fillsService.request(address);
  }

  /** A scan saw positions change: forget open times that no longer apply. */
  onSnapshot(prev: WalletSnapshot | undefined, snap: WalletSnapshot): void {
    if (!prev) return;
    for (const p of snap.positions) {
      const before = prev.positions.find((q) => q.coin === p.coin);
      if (!before || before.side !== p.side) this.cache.delete(key(snap.address, p.coin));
    }
  }

  ingest(address: string, fills: HLFill[], snap: WalletSnapshot): void {
    const now = Date.now();
    for (const p of snap.positions) {
      this.cache.set(key(address, p.coin), { side: p.side, checkedAt: now, ...findOpenTime(fills, p.coin, p.szi) });
    }
    this.persist();
    this.emit();
  }

  private persist(): void {
    if (this.cache.size > MAX_ENTRIES) {
      const sorted = [...this.cache].sort((a, b) => b[1].checkedAt - a[1].checkedAt).slice(0, MAX_ENTRIES);
      this.cache = new Map(sorted);
    }
    save('opentimes', [...this.cache]);
  }
}

export const openTimes = new OpenTimes();
