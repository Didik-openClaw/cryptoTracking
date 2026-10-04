import { getAllMids, getMetaAndAssetCtxs } from './api';
import { num } from './format';
import { Observable } from './observable';
import { socket } from './ws';

export interface CoinInfo {
  coin: string;
  mark: number;
  oracle: number;
  prevDayPx: number;
  funding: number; // hourly rate
  openInterest: number; // coins (one side)
  openInterestUsd: number;
  dayVolumeUsd: number;
  maxLeverage: number;
  szDecimals: number;
  delisted: boolean;
}

/** Market-wide data: asset contexts (OI, funding, volume) and live mid prices. */
class Market extends Observable {
  coins = new Map<string, CoinInfo>();
  mids = new Map<string, number>();
  loadedAt = 0;
  error = '';
  private started = false;
  private lastWsMids = 0;

  constructor() {
    super(500);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    socket.on('allMids', (d) => this.onMids((d as { mids?: Record<string, string> })?.mids));
    socket.addSubscription({ type: 'allMids' });
    void this.refresh();
    setInterval(() => void this.refresh(), 60_000);
    // REST fallback when the websocket is down.
    setInterval(() => {
      if (Date.now() - this.lastWsMids > 15_000) void getAllMids().then((m) => this.onMids(m, false), () => {});
    }, 10_000);
  }

  async refresh(): Promise<void> {
    try {
      const [meta, ctxs] = await getMetaAndAssetCtxs();
      meta.universe.forEach((u, i) => {
        const c = ctxs[i];
        if (!c) return;
        const mark = num(c.markPx);
        const oi = num(c.openInterest);
        this.coins.set(u.name, {
          coin: u.name,
          mark,
          oracle: num(c.oraclePx),
          prevDayPx: num(c.prevDayPx),
          funding: num(c.funding),
          openInterest: oi,
          openInterestUsd: oi * mark,
          dayVolumeUsd: num(c.dayNtlVlm),
          maxLeverage: u.maxLeverage,
          szDecimals: u.szDecimals,
          delisted: !!u.isDelisted,
        });
        if (!this.mids.has(u.name) && mark > 0) this.mids.set(u.name, mark);
      });
      this.loadedAt = Date.now();
      this.error = '';
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.emit();
  }

  private onMids(mids: Record<string, string> | undefined, fromWs = true): void {
    if (!mids) return;
    if (fromWs) this.lastWsMids = Date.now();
    for (const [k, v] of Object.entries(mids)) {
      if (k.startsWith('@')) continue; // spot pairs
      const n = num(v);
      if (n > 0) this.mids.set(k, n);
    }
    this.emit();
  }

  /** Perp coins sorted by 24h notional volume (most liquid first). */
  topCoins(n: number): string[] {
    return [...this.coins.values()]
      .filter((c) => !c.delisted)
      .sort((a, b) => b.dayVolumeUsd - a.dayVolumeUsd)
      .slice(0, n)
      .map((c) => c.coin);
  }
}

export const market = new Market();
