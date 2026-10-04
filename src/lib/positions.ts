import { num } from './format';
import type { HLClearinghouseState, HLPosition, LivePosition, Position, Side, WalletSnapshot } from './types';

export function parsePosition(p: HLPosition): Position {
  const szi = num(p.szi);
  const entryPx = num(p.entryPx);
  return {
    coin: p.coin,
    side: szi >= 0 ? 'long' : 'short',
    size: Math.abs(szi),
    szi,
    entryPx,
    positionValue: num(p.positionValue),
    unrealizedPnl: num(p.unrealizedPnl),
    roe: num(p.returnOnEquity),
    liquidationPx: p.liquidationPx === null || p.liquidationPx === undefined ? null : num(p.liquidationPx) || null,
    leverage: p.leverage?.value ?? 0,
    leverageType: p.leverage?.type === 'isolated' ? 'isolated' : 'cross',
    marginUsed: num(p.marginUsed),
    // Hyperliquid reports cumFunding as funding *paid*; flip so + means received.
    fundingSinceOpen: -num(p.cumFunding?.sinceOpen),
  };
}

export function parseClearinghouse(address: string, st: HLClearinghouseState, now = Date.now()): WalletSnapshot {
  const positions = (st.assetPositions ?? [])
    .map((ap) => parsePosition(ap.position))
    .filter((p) => p.size > 0)
    .sort((a, b) => b.positionValue - a.positionValue);
  return {
    address: address.toLowerCase(),
    accountValue: num(st.marginSummary?.accountValue),
    totalNtlPos: num(st.marginSummary?.totalNtlPos),
    marginUsed: num(st.marginSummary?.totalMarginUsed),
    withdrawable: num(st.withdrawable),
    positions,
    updatedAt: st.time || now,
  };
}

/** Distance from mark to liquidation as a fraction of mark (0.05 = 5% away). */
export function liqDistance(side: Side, mark: number, liq: number | null): number | null {
  if (liq === null || !(liq > 0) || !(mark > 0)) return null;
  return side === 'long' ? (mark - liq) / mark : (liq - mark) / mark;
}

/** Re-price a snapshot position with a live mid price. */
export function toLive(p: Position, w: WalletSnapshot, mids: Map<string, number>): LivePosition {
  const snapMark = p.size > 0 ? p.positionValue / p.size : p.entryPx;
  const mark = mids.get(p.coin) ?? snapMark;
  const notional = p.size * mark;
  const livePnl = p.szi * (mark - p.entryPx);
  const initMargin = p.leverage > 0 ? (p.entryPx * p.size) / p.leverage : p.marginUsed;
  return {
    ...p,
    address: w.address,
    mark,
    notional,
    livePnl,
    liveRoe: initMargin > 0 ? livePnl / initMargin : 0,
    liqDistance: liqDistance(p.side, mark, p.liquidationPx),
    accountValue: w.accountValue,
    updatedAt: w.updatedAt,
  };
}

export interface CoinAggregate {
  coin: string;
  longUsd: number;
  shortUsd: number;
  longCount: number;
  shortCount: number;
  longAvgEntry: number;
  shortAvgEntry: number;
  longPnl: number;
  shortPnl: number;
  mark: number;
}

/** Sum whale positions per coin, split by side, sorted by total notional. */
export function aggregateByCoin(positions: LivePosition[]): CoinAggregate[] {
  // Per coin: [entry*size, size] sums per side for size-weighted average entries.
  const acc = new Map<string, { a: CoinAggregate; lEntry: number; lSize: number; sEntry: number; sSize: number }>();
  for (const p of positions) {
    let e = acc.get(p.coin);
    if (!e) {
      e = {
        a: {
          coin: p.coin,
          longUsd: 0,
          shortUsd: 0,
          longCount: 0,
          shortCount: 0,
          longAvgEntry: 0,
          shortAvgEntry: 0,
          longPnl: 0,
          shortPnl: 0,
          mark: p.mark,
        },
        lEntry: 0,
        lSize: 0,
        sEntry: 0,
        sSize: 0,
      };
      acc.set(p.coin, e);
    }
    const { a } = e;
    if (p.side === 'long') {
      a.longUsd += p.notional;
      a.longCount++;
      a.longPnl += p.livePnl;
      e.lEntry += p.entryPx * p.size;
      e.lSize += p.size;
    } else {
      a.shortUsd += p.notional;
      a.shortCount++;
      a.shortPnl += p.livePnl;
      e.sEntry += p.entryPx * p.size;
      e.sSize += p.size;
    }
  }
  return [...acc.values()]
    .map(({ a, lEntry, lSize, sEntry, sSize }) => ({
      ...a,
      longAvgEntry: lSize > 0 ? lEntry / lSize : 0,
      shortAvgEntry: sSize > 0 ? sEntry / sSize : 0,
    }))
    .sort((x, y) => y.longUsd + y.shortUsd - (x.longUsd + x.shortUsd));
}
