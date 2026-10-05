import { info, Priority } from './api';
import { toApr } from './fundingCompare';

/**
 * Hourly funding history of one perp (`fundingHistory` info request).
 * Hyperliquid returns at most 500 rows counted from `startTime` forward, so a
 * 30-day window (720 hourly rows) takes two pages.
 */

export interface FundingPoint {
  time: number;
  /** Hourly funding rate. */
  rate: number;
  premium: number;
}

interface RawFundingRow {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
}

export const FUNDING_HISTORY_PAGE = 500;

export type FundingWindow = '24h' | '7d' | '30d';
export const FUNDING_WINDOWS: FundingWindow[] = ['24h', '7d', '30d'];
export const WINDOW_MS: Record<FundingWindow, number> = { '24h': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

/** Sorted, de-duplicated points; unreadable rows are dropped. */
export function parseFundingHistory(raw: unknown): FundingPoint[] {
  if (!Array.isArray(raw)) return [];
  const byTime = new Map<number, FundingPoint>();
  for (const r of raw as RawFundingRow[]) {
    const time = Number(r?.time);
    const rate = parseFloat(r?.fundingRate);
    if (!Number.isFinite(time) || !Number.isFinite(rate)) continue;
    const premium = parseFloat(r.premium);
    byTime.set(time, { time, rate, premium: Number.isFinite(premium) ? premium : 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** All rows from `startTime` to now (or `endTime`), paging forward 500 rows at a time. */
export async function fetchFundingHistory(
  coin: string,
  startTime: number,
  opts: { endTime?: number; signal?: AbortSignal; priority?: number; maxPages?: number } = {},
): Promise<FundingPoint[]> {
  const { endTime, signal, priority = Priority.User, maxPages = 4 } = opts;
  const all: unknown[] = [];
  let from = startTime;
  for (let page = 0; page < maxPages; page++) {
    const body: Record<string, unknown> = { type: 'fundingHistory', coin, startTime: from };
    if (endTime !== undefined) body.endTime = endTime;
    // weight 20 plus 1 per 20 rows returned
    const batch = await info<RawFundingRow[]>(body, { weight: 20, perItems: 20, priority, signal });
    if (!Array.isArray(batch) || !batch.length) break;
    all.push(...batch);
    if (batch.length < FUNDING_HISTORY_PAGE) break;
    const last = Math.max(...batch.map((r) => Number(r.time) || 0));
    if (last < from) break; // no progress: stop instead of looping
    from = last + 1;
    if (endTime !== undefined && from > endTime) break;
  }
  return parseFundingHistory(all);
}

// Funding settles hourly; a few minutes of reuse saves weight when the user
// flips between windows or comes back to the coin.
const CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; from: number; points: FundingPoint[] }>();

/** The coin's funding over the last `window`, reusing a fresh cached wider window when there is one. */
export async function loadFundingWindow(coin: string, window: FundingWindow, signal?: AbortSignal, now = Date.now()): Promise<FundingPoint[]> {
  const from = now - WINDOW_MS[window];
  const hit = cache.get(coin);
  if (hit && now - hit.at < CACHE_MS && hit.from <= from) return hit.points.filter((p) => p.time >= from);
  const points = await fetchFundingHistory(coin, from, { signal });
  cache.set(coin, { at: now, from, points });
  return points;
}

export interface FundingSummary {
  count: number;
  /** Latest hourly rate. */
  current: number;
  avg: number;
  min: number;
  max: number;
  /** Sum of the hourly rates: what a position held over the whole window paid (long) or earned (short), as a fraction of notional. */
  cumulative: number;
  /** Share of hours with positive funding (longs paying). */
  positiveShare: number;
  /** All of the above as APR, for display. */
  apr: { current: number; avg: number; min: number; max: number };
}

export function summarizeFunding(points: FundingPoint[]): FundingSummary | null {
  if (!points.length) return null;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let pos = 0;
  for (const p of points) {
    sum += p.rate;
    if (p.rate < min) min = p.rate;
    if (p.rate > max) max = p.rate;
    if (p.rate > 0) pos++;
  }
  const current = points[points.length - 1].rate;
  const avg = sum / points.length;
  return {
    count: points.length,
    current,
    avg,
    min,
    max,
    cumulative: sum,
    positiveShare: pos / points.length,
    apr: { current: toApr(current), avg: toApr(avg), min: toApr(min), max: toApr(max) },
  };
}
