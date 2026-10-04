import { num } from './format';
import type { HLFill } from './types';

export interface CoinStat {
  coin: string;
  volume: number;
  pnl: number;
  fills: number;
}

export interface FillStats {
  fills: number;
  volume: number;
  fees: number;
  realizedPnl: number; // sum of closedPnl, before fees
  netPnl: number; // after fees
  wins: number;
  losses: number;
  winRate: number | null;
  biggestWin: number;
  biggestLoss: number;
  liquidations: number;
  firstTime: number;
  lastTime: number;
  byCoin: CoinStat[];
}

export function computeFillStats(fills: HLFill[]): FillStats {
  const s: FillStats = {
    fills: fills.length,
    volume: 0,
    fees: 0,
    realizedPnl: 0,
    netPnl: 0,
    wins: 0,
    losses: 0,
    winRate: null,
    biggestWin: 0,
    biggestLoss: 0,
    liquidations: 0,
    firstTime: Infinity,
    lastTime: 0,
    byCoin: [],
  };
  const coins = new Map<string, CoinStat>();
  for (const f of fills) {
    const usd = num(f.sz) * num(f.px);
    const pnl = num(f.closedPnl);
    s.volume += usd;
    s.fees += num(f.fee);
    s.realizedPnl += pnl;
    if (pnl > 0) s.wins++;
    else if (pnl < 0) s.losses++;
    s.biggestWin = Math.max(s.biggestWin, pnl);
    s.biggestLoss = Math.min(s.biggestLoss, pnl);
    if (f.liquidation || /liquidat/i.test(f.dir)) s.liquidations++;
    s.firstTime = Math.min(s.firstTime, f.time);
    s.lastTime = Math.max(s.lastTime, f.time);
    let c = coins.get(f.coin);
    if (!c) coins.set(f.coin, (c = { coin: f.coin, volume: 0, pnl: 0, fills: 0 }));
    c.volume += usd;
    c.pnl += pnl;
    c.fills++;
  }
  s.netPnl = s.realizedPnl - s.fees;
  const closes = s.wins + s.losses;
  s.winRate = closes ? s.wins / closes : null;
  if (!fills.length) s.firstTime = 0;
  s.byCoin = [...coins.values()].sort((a, b) => b.volume - a.volume);
  return s;
}
