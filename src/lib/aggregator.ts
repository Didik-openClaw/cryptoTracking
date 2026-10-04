import { num } from './format';
import type { HLWsTrade } from './types';

export interface BigTrade {
  id: string;
  coin: string;
  side: 'buy' | 'sell'; // taker (aggressor) side
  taker: string;
  notional: number;
  size: number;
  avgPx: number;
  fills: number;
  time: number;
  hash: string;
  topMaker: { address: string; usd: number } | null;
}

interface Bucket {
  key: string;
  coin: string;
  side: 'buy' | 'sell';
  taker: string;
  size: number;
  notional: number;
  fills: number;
  firstTime: number;
  hash: string;
  makers: Map<string, number>;
  touchedAt: number;
}

const ZERO_HASH = /^0x0*$/;

/**
 * Hyperliquid's `trades` stream emits one message per maker fill, so a single
 * $5M market order can arrive as dozens of small trades. Fills sharing the
 * taker's transaction hash (or, for hash-less TWAP/liquidation fills, the same
 * taker + coin + timestamp) are merged back into one order.
 */
export class TradeAggregator {
  private buckets = new Map<string, Bucket>();

  add(t: HLWsTrade, now: number): void {
    const side = t.side === 'B' ? 'buy' : 'sell';
    const [buyer, seller] = t.users ?? ['', ''];
    const taker = (side === 'buy' ? buyer : seller)?.toLowerCase() ?? '';
    const maker = (side === 'buy' ? seller : buyer)?.toLowerCase() ?? '';
    const key = t.hash && !ZERO_HASH.test(t.hash) ? `${t.hash}|${t.coin}` : `${t.coin}|${taker}|${side}|${t.time}`;
    const sz = num(t.sz);
    const usd = sz * num(t.px);
    let b = this.buckets.get(key);
    if (!b) {
      b = {
        key,
        coin: t.coin,
        side,
        taker,
        size: 0,
        notional: 0,
        fills: 0,
        firstTime: t.time,
        hash: t.hash,
        makers: new Map(),
        touchedAt: now,
      };
      this.buckets.set(key, b);
    }
    b.size += sz;
    b.notional += usd;
    b.fills++;
    b.firstTime = Math.min(b.firstTime, t.time);
    b.touchedAt = now;
    if (maker) b.makers.set(maker, (b.makers.get(maker) ?? 0) + usd);
  }

  /** Return (and forget) orders that received no fill for `idleMs`. */
  flush(now: number, idleMs = 1500): BigTrade[] {
    const out: BigTrade[] = [];
    for (const [k, b] of this.buckets) {
      if (now - b.touchedAt < idleMs) continue;
      this.buckets.delete(k);
      let topMaker: BigTrade['topMaker'] = null;
      for (const [address, usd] of b.makers) if (!topMaker || usd > topMaker.usd) topMaker = { address, usd };
      out.push({
        id: k,
        coin: b.coin,
        side: b.side,
        taker: b.taker,
        notional: b.notional,
        size: b.size,
        avgPx: b.size > 0 ? b.notional / b.size : 0,
        fills: b.fills,
        time: b.firstTime,
        hash: b.hash,
        topMaker,
      });
    }
    return out;
  }

  get pending(): number {
    return this.buckets.size;
  }
}
