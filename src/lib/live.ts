import { market } from './market';
import { Observable } from './observable';
import { scanner } from './scanner';
import { settings } from './settings';
import { beep } from './sound';
import type { HLWsTrade } from './types';
import { socket } from './ws';
import { TradeAggregator, type BigTrade } from './aggregator';

export type { BigTrade } from './aggregator';

/** Trades smaller than this are not kept even if the display threshold is lowered. */
export const LIVE_KEEP_FLOOR_USD = 100_000;
const MAX_TRADES = 1500;

class LiveFeed extends Observable {
  trades: BigTrade[] = [];
  fillsSeen = 0;
  ordersSeen = 0;
  startedAt = 0;
  coins: string[] = [];
  private agg = new TradeAggregator();
  private listeners = new Set<(t: BigTrade) => void>();
  private started = false;

  constructor() {
    super(400);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.startedAt = Date.now();
    socket.on('trades', (d) => {
      const now = Date.now();
      for (const t of (d as HLWsTrade[]) ?? []) {
        this.fillsSeen++;
        this.agg.add(t, now);
      }
    });
    setInterval(() => this.flush(), 500);
    market.subscribe(() => this.syncCoins());
    settings.subscribe(() => this.syncCoins());
    this.syncCoins();
  }

  onBigTrade(cb: (t: BigTrade) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  clear(): void {
    this.trades = [];
    this.emit(true);
  }

  private syncCoins(): void {
    const top = market.topCoins(settings.value.liveTopCoins);
    if (!top.length || top.join() === this.coins.join()) return;
    this.coins = top;
    socket.syncType(
      'trades',
      top.map((coin) => ({ type: 'trades', coin })),
    );
    this.emit();
  }

  private flush(): void {
    const done = this.agg.flush(Date.now());
    if (!done.length) return;
    const s = settings.value;
    let alerted = false;
    for (const t of done) {
      this.ordersSeen++;
      if (t.notional < LIVE_KEEP_FLOOR_USD) continue;
      this.trades.unshift(t);
      if (t.notional < s.liveMinUsd) continue;
      // Big trader spotted: make sure the scanner checks their positions.
      if (t.taker) scanner.enqueue(t.taker, 'live', t.notional);
      if (t.topMaker && t.topMaker.usd >= s.liveMinUsd) scanner.enqueue(t.topMaker.address, 'live', t.topMaker.usd);
      for (const cb of this.listeners) cb(t);
      alerted = true;
    }
    if (this.trades.length > MAX_TRADES) this.trades.length = MAX_TRADES;
    if (alerted && s.liveSound) beep(660, 0.08);
    this.emit();
  }
}

export const live = new LiveFeed();
