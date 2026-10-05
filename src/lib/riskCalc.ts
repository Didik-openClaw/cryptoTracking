/**
 * Risk & position calculator for Hyperliquid perps: pure functions, no app
 * state, so every number on the CALC page can be checked by hand in tests.
 *
 * Conventions:
 * - Fees and funding are fractions (0.00045 = 0.045 %); risk in `pct` mode
 *   and TP shares are percents (1 = 1 %), as typed by the user.
 * - The stop-loss always fills as a taker (stop-market). The entry and the
 *   take-profits are taker for market orders and maker for limit orders.
 * - Position size is floored to the coin's `szDecimals`, so the loss at the
 *   stop (fees included) never exceeds the risk budget.
 */

export type TradeSide = 'long' | 'short';
export type MarginMode = 'isolated' | 'cross';
export type OrderType = 'market' | 'limit';
export type RiskMode = 'pct' | 'usd';

export const DEFAULT_TAKER_FEE = 0.00045; // 0.045 %
export const DEFAULT_MAKER_FEE = 0.00015; // 0.015 %
/** Hyperliquid rejects orders worth less than this. */
export const MIN_ORDER_USD = 10;
export const MAX_TPS = 3;
/** Above this share of the account at risk the calculator warns. */
export const HIGH_RISK = 0.02;
/** Fees eating at least this share of the stop loss means the stop is very tight. */
export const HEAVY_FEES = 0.2;

export const sideSign = (side: TradeSide): 1 | -1 => (side === 'long' ? 1 : -1);

/** Round down to `decimals` places (the epsilon absorbs float noise such as 0.29 × 100 = 28.999…). */
export function floorTo(x: number, decimals: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  const f = 10 ** decimals;
  return Number((Math.floor(x * f + 1e-7) / f).toFixed(decimals));
}

/**
 * A price Hyperliquid accepts for a perp: at most 5 significant figures and at
 * most (6 − szDecimals) decimals. Integer prices are always valid.
 */
export function roundPx(px: number, szDecimals: number): number {
  if (!Number.isFinite(px) || px <= 0) return 0;
  if (px >= 1e5) return Math.round(px);
  const maxDecimals = Math.max(0, 6 - szDecimals);
  return Number(Number(px.toPrecision(5)).toFixed(maxDecimals));
}

/** USD the trade may lose at the stop: a percent of the account, or a fixed amount. */
export function riskBudget(account: number, mode: RiskMode, value: number): number {
  return mode === 'pct' ? (account * value) / 100 : value;
}

/** Loss per coin when the stop fills: the price move plus the entry fee and the (taker) stop fee. */
export function lossPerCoin(side: TradeSide, entry: number, stop: number, entryFee: number, stopFee: number): number {
  return sideSign(side) * (entry - stop) + entry * entryFee + stop * stopFee;
}

/** Net PnL per coin when the position is closed at `exit`, after the entry and exit fees. */
export function pnlPerCoin(side: TradeSide, entry: number, exit: number, entryFee: number, exitFee: number): number {
  return sideSign(side) * (exit - entry) - entry * entryFee - exit * exitFee;
}

/** Exit price at which the trade nets zero after both fees (funding not included). */
export function breakEvenPrice(side: TradeSide, entry: number, entryFee: number, exitFee: number): number {
  return side === 'long' ? (entry * (1 + entryFee)) / (1 - exitFee) : (entry * (1 - entryFee)) / (1 + exitFee);
}

/**
 * Funding over `hours` at a constant hourly rate: positive = paid, negative =
 * received. Longs pay shorts when the rate is positive. Uses the entry
 * notional; real funding is charged hourly on the oracle-price notional.
 */
export function fundingCost(side: TradeSide, notional: number, hourlyRate: number, hours: number): number {
  return sideSign(side) * notional * hourlyRate * hours;
}

/** Hyperliquid maintenance margin rate: half the initial margin at max leverage. */
export const maintenanceRate = (maxLeverage: number) => 1 / (2 * maxLeverage);

/**
 * Estimated liquidation price, from Hyperliquid's documented formula
 *
 *   liq = entry − side × marginAvailable / size / (1 − mm × side)
 *   marginAvailable = margin − mm × entry × size,  mm = 1 / (2 × maxLeverage)
 *
 * with side = +1 long / −1 short. Isolated: margin = notional / leverage,
 * which gives entry × (1 − side × (1/leverage − mm) / (1 − mm × side)), within
 * a fraction of a percent of the rule of thumb entry × (1 ∓ (1/leverage − mm)).
 * Cross: margin = the whole account equity, assuming this is the only position.
 *
 * It is an approximation: it ignores fees, accrued funding, PnL of other cross
 * positions, and that the mark price (not the last trade) triggers liquidation.
 * Returns null when there is no positive liquidation price (an over-collateralised long).
 */
export function liquidationPrice(p: {
  side: TradeSide;
  entry: number;
  size: number;
  margin: number;
  maxLeverage: number;
}): number | null {
  const { side, entry, size, margin, maxLeverage } = p;
  if (!(entry > 0 && size > 0 && maxLeverage > 0)) return null;
  const s = sideSign(side);
  const mm = maintenanceRate(maxLeverage);
  const available = margin - mm * entry * size;
  const px = entry - (s * available) / size / (1 - mm * s);
  return Number.isFinite(px) && px > 0 ? px : null;
}

/** Isolated-margin liquidation price; independent of size. */
export function isolatedLiqPrice(side: TradeSide, entry: number, leverage: number, maxLeverage: number): number | null {
  return liquidationPrice({ side, entry, size: 1, margin: entry / leverage, maxLeverage });
}

/**
 * Share of the position closed at each TP (fractions, in order). Shares are
 * clamped so they never total more than 100 %, and whatever is not allocated
 * closes at the last TP.
 */
export function allocateTps(pcts: number[]): { shares: number[]; over: boolean; under: boolean } {
  const total = pcts.reduce((t, p) => t + Math.max(0, p || 0), 0);
  let left = 100;
  const shares = pcts.map((p, i) => {
    const v = i === pcts.length - 1 ? left : Math.min(left, Math.max(0, p || 0));
    left -= v;
    return v / 100;
  });
  return { shares, over: total > 100 + 1e-9, under: pcts.length > 0 && total < 100 - 1e-9 };
}

/** Size per TP in whole order lots: each TP is floored, the last one takes the rest. */
export function splitSize(size: number, shares: number[], szDecimals: number): number[] {
  let used = 0;
  return shares.map((sh, i) => {
    const v = i === shares.length - 1 ? Number(Math.max(0, size - used).toFixed(szDecimals)) : floorTo(size * sh, szDecimals);
    used += v;
    return v;
  });
}

export interface CalcInput {
  side: TradeSide;
  account: number;
  riskMode: RiskMode;
  /** Percent of the account (1 = 1 %) in `pct` mode, USD in `usd` mode. */
  risk: number;
  entry: number;
  stop: number;
  /** Up to 3 take-profits; a price ≤ 0 means unused. `pct` = percent of the position closed there. */
  tps: { price: number; pct: number }[];
  leverage: number;
  maxLeverage: number;
  szDecimals: number;
  marginMode: MarginMode;
  takerFee: number;
  makerFee: number;
  entryOrder: OrderType;
  tpOrder: OrderType;
  /** Current hourly funding rate (fraction). */
  fundingRate: number;
  holdHours: number;
}

export type CalcError = 'account' | 'risk' | 'entry' | 'stop' | 'stopSide' | 'leverage' | 'sizeZero';
export type CalcWarning =
  | 'stopBeyondLiq'
  | 'marginOverAccount'
  | 'belowMinOrder'
  | 'tpWrongSide'
  | 'tpOver100'
  | 'tpUnder100'
  | 'highRisk'
  | 'heavyFees';

export interface TpResult {
  /** 1-based TP number as entered. */
  n: number;
  price: number;
  /** Fraction of the position closed here. */
  share: number;
  size: number;
  /** Net PnL of this partial close (fees included). */
  pnl: number;
  pnlPctAccount: number;
  /** Net reward per coin / net risk per coin (fees included). */
  r: number;
  /** Price distance to the TP / price distance to the stop. */
  rGross: number;
  /** Price move from entry to the TP as a fraction (signed in the trade's favour). */
  movePct: number;
}

export interface CalcResult {
  ok: boolean;
  errors: CalcError[];
  warnings: CalcWarning[];
  budget: number;
  entryFee: number;
  exitFee: number;
  stopFee: number;
  sizeRaw: number;
  size: number;
  notional: number;
  margin: number;
  marginPctAccount: number;
  /** Lowest leverage at which the margin fits the account. */
  minLeverage: number;
  lossPerCoin: number;
  maxLoss: number;
  maxLossPctAccount: number;
  /** Entry + stop fees in USD, part of maxLoss. */
  feesAtStop: number;
  stopPct: number;
  tps: TpResult[];
  tpPnl: number;
  tpPnlPctAccount: number;
  blendedR: number | null;
  breakEven: number;
  liqIsolated: number | null;
  liqCross: number | null;
  /** Liquidation price for the selected margin mode. */
  liq: number | null;
  /** Distance from entry to `liq` as a fraction of entry. */
  liqDistance: number | null;
  stopBeyondLiq: boolean;
  fundingCost: number;
  fundingPctAccount: number;
}

function empty(errors: CalcError[]): CalcResult {
  return {
    ok: false,
    errors,
    warnings: [],
    budget: 0,
    entryFee: 0,
    exitFee: 0,
    stopFee: 0,
    sizeRaw: 0,
    size: 0,
    notional: 0,
    margin: 0,
    marginPctAccount: 0,
    minLeverage: 0,
    lossPerCoin: 0,
    maxLoss: 0,
    maxLossPctAccount: 0,
    feesAtStop: 0,
    stopPct: 0,
    tps: [],
    tpPnl: 0,
    tpPnlPctAccount: 0,
    blendedR: null,
    breakEven: 0,
    liqIsolated: null,
    liqCross: null,
    liq: null,
    liqDistance: null,
    stopBeyondLiq: false,
    fundingCost: 0,
    fundingPctAccount: 0,
  };
}

/** Everything the calculator shows, from one set of inputs. */
export function calculate(i: CalcInput): CalcResult {
  const s = sideSign(i.side);
  const budget = riskBudget(i.account, i.riskMode, i.risk);
  const errors: CalcError[] = [];
  if (!(i.account > 0)) errors.push('account');
  if (!(budget > 0) || (i.account > 0 && budget > i.account)) errors.push('risk');
  if (!(i.entry > 0)) errors.push('entry');
  if (!(i.stop > 0)) errors.push('stop');
  else if (i.entry > 0 && !(s * (i.entry - i.stop) > 0)) errors.push('stopSide');
  if (!(i.leverage >= 1 && i.leverage <= i.maxLeverage)) errors.push('leverage');
  if (errors.length) return empty(errors);

  const entryFee = i.entryOrder === 'limit' ? i.makerFee : i.takerFee;
  const exitFee = i.tpOrder === 'limit' ? i.makerFee : i.takerFee;
  const stopFee = i.takerFee;

  const perCoin = lossPerCoin(i.side, i.entry, i.stop, entryFee, stopFee);
  const sizeRaw = budget / perCoin;
  const size = floorTo(sizeRaw, i.szDecimals);
  if (!(size > 0)) return { ...empty(['sizeZero']), budget, sizeRaw, lossPerCoin: perCoin };

  const notional = size * i.entry;
  const margin = notional / i.leverage;
  const maxLoss = size * perCoin;
  const feesAtStop = size * (i.entry * entryFee + i.stop * stopFee);

  // Take-profits: keep the ones on the profitable side of entry, in the order entered.
  const entered = i.tps.map((t, k) => ({ ...t, n: k + 1 })).filter((t) => t.price > 0);
  const valid = entered.filter((t) => s * (t.price - i.entry) > 0);
  const alloc = allocateTps(valid.map((t) => t.pct));
  const sizes = splitSize(size, alloc.shares, i.szDecimals);
  const tps: TpResult[] = valid.map((t, k) => {
    const pnl = sizes[k] * pnlPerCoin(i.side, i.entry, t.price, entryFee, exitFee);
    return {
      n: t.n,
      price: t.price,
      share: alloc.shares[k],
      size: sizes[k],
      pnl,
      pnlPctAccount: pnl / i.account,
      r: pnlPerCoin(i.side, i.entry, t.price, entryFee, exitFee) / perCoin,
      rGross: (s * (t.price - i.entry)) / (s * (i.entry - i.stop)),
      movePct: (s * (t.price - i.entry)) / i.entry,
    };
  });
  const tpPnl = tps.reduce((t, x) => t + x.pnl, 0);

  const liqIsolated = isolatedLiqPrice(i.side, i.entry, i.leverage, i.maxLeverage);
  const liqCross = liquidationPrice({ side: i.side, entry: i.entry, size, margin: i.account, maxLeverage: i.maxLeverage });
  const liq = i.marginMode === 'isolated' ? liqIsolated : liqCross;
  const stopBeyondLiq = liq !== null && s * (i.stop - liq) <= 0;
  const funding = fundingCost(i.side, notional, i.fundingRate, Math.max(0, i.holdHours));

  const warnings: CalcWarning[] = [];
  if (stopBeyondLiq) warnings.push('stopBeyondLiq');
  if (margin > i.account) warnings.push('marginOverAccount');
  if (notional < MIN_ORDER_USD) warnings.push('belowMinOrder');
  if (entered.length > valid.length) warnings.push('tpWrongSide');
  if (alloc.over) warnings.push('tpOver100');
  else if (alloc.under && valid.length) warnings.push('tpUnder100');
  if (maxLoss / i.account > HIGH_RISK) warnings.push('highRisk');
  if (feesAtStop >= HEAVY_FEES * maxLoss) warnings.push('heavyFees');

  return {
    ok: true,
    errors: [],
    warnings,
    budget,
    entryFee,
    exitFee,
    stopFee,
    sizeRaw,
    size,
    notional,
    margin,
    marginPctAccount: margin / i.account,
    minLeverage: Math.ceil(notional / i.account - 1e-9),
    lossPerCoin: perCoin,
    maxLoss,
    maxLossPctAccount: maxLoss / i.account,
    feesAtStop,
    stopPct: (s * (i.entry - i.stop)) / i.entry,
    tps,
    tpPnl,
    tpPnlPctAccount: tpPnl / i.account,
    blendedR: tps.length && maxLoss > 0 ? tpPnl / maxLoss : null,
    breakEven: breakEvenPrice(i.side, i.entry, entryFee, stopFee),
    liqIsolated,
    liqCross,
    liq,
    liqDistance: liq === null ? null : Math.abs(i.entry - liq) / i.entry,
    stopBeyondLiq,
    fundingCost: funding,
    fundingPctAccount: funding / i.account,
  };
}
