import { toApr } from './fundingCompare';
import type { CoinInfo } from './market';

/** Rows and totals for the market screener (MRKT). Pure functions over the market store. */

/** |APR| from which funding counts as extreme. */
export const EXTREME_APR = 0.5;
export const TOP_BY_VOLUME = 30;

export interface ScreenRow {
  coin: string;
  /** Live mid when available, else the last mark. */
  mark: number;
  change: number;
  volume: number;
  oiUsd: number;
  /** Open interest ÷ 24h volume: high = positions sit, low = churn. NaN without volume. */
  oiVol: number;
  /** Hourly funding rate. */
  funding: number;
  apr: number;
  /** Mark ÷ oracle − 1 from the same snapshot (NaN without an oracle price). */
  basis: number;
  maxLeverage: number;
}

export function screenRows(coins: Iterable<CoinInfo>, mids: Map<string, number>): ScreenRow[] {
  const out: ScreenRow[] = [];
  for (const c of coins) {
    if (c.delisted) continue;
    const mark = mids.get(c.coin) ?? c.mark;
    const oiUsd = c.openInterest * mark;
    out.push({
      coin: c.coin,
      mark,
      change: c.prevDayPx ? mark / c.prevDayPx - 1 : 0,
      volume: c.dayVolumeUsd,
      oiUsd,
      oiVol: c.dayVolumeUsd > 0 ? oiUsd / c.dayVolumeUsd : NaN,
      funding: c.funding,
      apr: toApr(c.funding),
      basis: c.oracle > 0 && c.mark > 0 ? c.mark / c.oracle - 1 : NaN,
      maxLeverage: c.maxLeverage,
    });
  }
  return out;
}

export function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface ScreenSummary {
  count: number;
  totalOi: number;
  totalVolume: number;
  /** Hourly rates: plain mean, median and open-interest-weighted mean. */
  avgFunding: number;
  medianFunding: number;
  oiWeightedFunding: number;
  positive: number;
  negative: number;
  extremePos: number;
  extremeNeg: number;
  biggest: ScreenRow | null;
}

export function summarize(rows: ScreenRow[], extremeApr = EXTREME_APR): ScreenSummary {
  let totalOi = 0;
  let totalVolume = 0;
  let sum = 0;
  let weighted = 0;
  let positive = 0;
  let negative = 0;
  let extremePos = 0;
  let extremeNeg = 0;
  let biggest: ScreenRow | null = null;
  for (const r of rows) {
    totalOi += r.oiUsd;
    totalVolume += r.volume;
    sum += r.funding;
    weighted += r.funding * r.oiUsd;
    if (r.funding > 0) positive++;
    if (r.funding < 0) negative++;
    if (r.apr >= extremeApr) extremePos++;
    if (r.apr <= -extremeApr) extremeNeg++;
    if (!biggest || r.oiUsd > biggest.oiUsd) biggest = r;
  }
  return {
    count: rows.length,
    totalOi,
    totalVolume,
    avgFunding: rows.length ? sum / rows.length : NaN,
    medianFunding: median(rows.map((r) => r.funding)),
    oiWeightedFunding: totalOi > 0 ? weighted / totalOi : NaN,
    positive,
    negative,
    extremePos,
    extremeNeg,
    biggest,
  };
}

export type QuickFilter = 'all' | 'pos' | 'neg' | 'top';

/** Case-insensitive coin search plus a quick filter. */
export function filterRows(rows: ScreenRow[], filter: QuickFilter, query: string): ScreenRow[] {
  const q = query.trim().toUpperCase();
  let out = q ? rows.filter((r) => r.coin.toUpperCase().includes(q)) : rows;
  if (filter === 'pos') out = out.filter((r) => r.funding > 0);
  else if (filter === 'neg') out = out.filter((r) => r.funding < 0);
  else if (filter === 'top') {
    const top = new Set([...rows].sort((a, b) => b.volume - a.volume).slice(0, TOP_BY_VOLUME).map((r) => r.coin));
    out = out.filter((r) => top.has(r.coin));
  }
  return out;
}

/** 0–1 intensity of a value against the level that counts as "full" colour. */
export const heat = (v: number, full: number) => (Number.isFinite(v) && full > 0 ? Math.min(1, Math.abs(v) / full) : 0);
