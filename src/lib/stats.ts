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

// ---- Round-trip trade statistics ----

/** A position from open (from flat, or a flip) to close (back to flat, or a flip). */
export interface RoundTrip {
  coin: string;
  side: 'long' | 'short';
  openAt: number;
  closeAt: number;
  pnl: number; // sum of closedPnl over the trip, before fees
}

export interface TraderStats {
  fills: number;
  from: number;
  to: number;
  trades: number; // completed round trips
  wins: number;
  losses: number;
  winRate: number | null;
  grossProfit: number;
  grossLoss: number; // positive number
  /** grossProfit / grossLoss; Infinity when there were wins and no losses. */
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number; // positive number
  /** avgWin / avgLoss */
  payoff: number | null;
  /** Average PnL per completed trade. */
  expectancy: number | null;
  bestTrade: number;
  worstTrade: number;
  maxWinStreak: number;
  maxLossStreak: number;
  avgHoldMs: number | null;
  realizedPnl: number; // every closedPnl in the window, before fees
  fees: number;
  volume: number;
  /** Share of opening notional that went long (0..1). */
  longShare: number | null;
  tradesPerDay: number | null;
  topCoins: string[];
}

const EPS = 1e-9;

/**
 * Rebuild round trips from fills (any order). Positions already open when the
 * fill window starts are skipped until they go flat, since their opening is
 * not visible.
 */
export function roundTrips(fills: HLFill[]): RoundTrip[] {
  const asc = [...fills].sort((a, b) => a.time - b.time || a.tid - b.tid);
  const state = new Map<string, { tracking: boolean; openAt: number; pnl: number }>();
  const trips: RoundTrip[] = [];
  for (const f of asc) {
    const start = num(f.startPosition);
    const after = start + (f.side === 'B' ? 1 : -1) * num(f.sz);
    let s = state.get(f.coin);
    if (!s) state.set(f.coin, (s = { tracking: false, openAt: 0, pnl: 0 }));
    const flatBefore = Math.abs(start) < EPS;
    const flatAfter = Math.abs(after) < EPS;
    const ends = !flatBefore && (flatAfter || Math.sign(after) !== Math.sign(start));
    if (s.tracking) {
      s.pnl += num(f.closedPnl);
      if (ends) {
        trips.push({ coin: f.coin, side: start > 0 ? 'long' : 'short', openAt: s.openAt, closeAt: f.time, pnl: s.pnl });
        s.tracking = false;
      }
    }
    if (!flatAfter && (flatBefore || ends)) {
      s.tracking = true;
      s.openAt = f.time;
      s.pnl = 0;
    }
  }
  return trips;
}

export function computeTraderStats(fills: HLFill[]): TraderStats {
  const trips = roundTrips(fills).sort((a, b) => a.closeAt - b.closeAt);
  let grossProfit = 0,
    grossLoss = 0,
    wins = 0,
    losses = 0,
    best = 0,
    worst = 0,
    hold = 0,
    streakW = 0,
    streakL = 0,
    maxW = 0,
    maxL = 0;
  for (const t of trips) {
    hold += t.closeAt - t.openAt;
    best = Math.max(best, t.pnl);
    worst = Math.min(worst, t.pnl);
    if (t.pnl > 0) {
      wins++;
      grossProfit += t.pnl;
      streakW++;
      streakL = 0;
    } else if (t.pnl < 0) {
      losses++;
      grossLoss -= t.pnl;
      streakL++;
      streakW = 0;
    }
    maxW = Math.max(maxW, streakW);
    maxL = Math.max(maxL, streakL);
  }

  let realizedPnl = 0,
    fees = 0,
    volume = 0,
    openLong = 0,
    openTotal = 0,
    from = Infinity,
    to = 0;
  const coinVol = new Map<string, number>();
  for (const f of fills) {
    const usd = num(f.sz) * num(f.px);
    realizedPnl += num(f.closedPnl);
    fees += num(f.fee);
    volume += usd;
    from = Math.min(from, f.time);
    to = Math.max(to, f.time);
    coinVol.set(f.coin, (coinVol.get(f.coin) ?? 0) + usd);
    // Opening notional: the part of a fill that grows the position away from zero.
    const start = num(f.startPosition);
    const after = start + (f.side === 'B' ? 1 : -1) * num(f.sz);
    const opened = Math.sign(after) === Math.sign(start) || Math.abs(start) < EPS ? Math.max(0, Math.abs(after) - Math.abs(start)) : Math.abs(after);
    if (opened > EPS) {
      openTotal += opened * num(f.px);
      if (after > 0) openLong += opened * num(f.px);
    }
  }
  if (!fills.length) from = 0;

  const decided = wins + losses;
  const days = fills.length ? Math.max(1, (to - from) / 86_400_000) : 0;
  return {
    fills: fills.length,
    from,
    to,
    trades: trips.length,
    wins,
    losses,
    winRate: decided ? wins / decided : null,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    avgWin: wins ? grossProfit / wins : 0,
    avgLoss: losses ? grossLoss / losses : 0,
    payoff: wins && losses ? grossProfit / wins / (grossLoss / losses) : null,
    expectancy: trips.length ? (grossProfit - grossLoss) / trips.length : null,
    bestTrade: best,
    worstTrade: worst,
    maxWinStreak: maxW,
    maxLossStreak: maxL,
    avgHoldMs: trips.length ? hold / trips.length : null,
    realizedPnl,
    fees,
    volume,
    longShare: openTotal > 0 ? openLong / openTotal : null,
    tradesPerDay: days ? trips.length / days : null,
    topCoins: [...coinVol].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c]) => c),
  };
}
