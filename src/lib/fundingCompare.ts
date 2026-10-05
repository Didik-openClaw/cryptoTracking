import { info, Priority } from './api';

/**
 * Cross-exchange funding comparison from the `predictedFundings` info
 * request: the next funding rate Hyperliquid predicts for each perp on its own
 * book and on Binance and Bybit. Venues settle on different intervals
 * (Hyperliquid hourly, the CEXs usually every 8h, some coins every 4h), so
 * every rate is normalised to an hourly rate before it is compared.
 */

export const HOURS_PER_YEAR = 24 * 365;

/** Hourly rate → simple annualised rate (APR, not compounded). */
export const toApr = (hourly: number) => hourly * HOURS_PER_YEAR;

export type VenueKey = 'hl' | 'bin' | 'bybit';
export type OtherVenue = Exclude<VenueKey, 'hl'>;

/** Venue ids as the API names them. */
export const VENUE_IDS: Record<VenueKey, string> = { hl: 'HlPerp', bin: 'BinPerp', bybit: 'BybitPerp' };
export const VENUE_LABELS: Record<VenueKey, string> = { hl: 'HL', bin: 'Binance', bybit: 'Bybit' };
export const OTHER_VENUES: OtherVenue[] = ['bin', 'bybit'];

/** Spread (APR) from which the table suggests a trade. */
export const ARB_MIN_APR = 0.1;

export interface RawVenueFunding {
  fundingRate: string | number;
  nextFundingTime: number;
  fundingIntervalHours?: number | null;
}
export type RawPredictedFundings = [string, ([string, RawVenueFunding | null] | null)[] | null][];

export interface VenueFunding {
  venue: string;
  /** Rate per funding interval, as reported. */
  rate: number;
  intervalHours: number;
  hourly: number;
  apr: number;
  nextFundingTime: number;
}

export interface FundingCompareRow {
  coin: string;
  hl: VenueFunding | null;
  bin: VenueFunding | null;
  bybit: VenueFunding | null;
  /** HL APR minus that venue's APR; null when either side is missing. */
  spread: Record<OtherVenue, number | null>;
  /** The venue with the largest absolute spread against HL. */
  best: { venue: OtherVenue; spread: number } | null;
}

export interface ArbHint {
  long: VenueKey;
  short: VenueKey;
  /** Funding earned per year on the hedged pair, before fees and price risk. */
  spreadApr: number;
}

/** Settlement interval when the API does not say: Hyperliquid pays hourly, Binance/Bybit (and other CEXs) every 8h. */
export function defaultIntervalHours(venue: string): number {
  return venue === VENUE_IDS.hl ? 1 : 8;
}

/** One venue's entry, normalised to an hourly rate; null when missing or unreadable. */
export function normalizeVenue(venue: string, raw: RawVenueFunding | null | undefined): VenueFunding | null {
  if (!raw || typeof raw !== 'object') return null;
  const rate = typeof raw.fundingRate === 'number' ? raw.fundingRate : parseFloat(raw.fundingRate);
  if (!Number.isFinite(rate)) return null;
  const given = Number(raw.fundingIntervalHours);
  const intervalHours = Number.isFinite(given) && given > 0 ? given : defaultIntervalHours(venue);
  const hourly = rate / intervalHours;
  return { venue, rate, intervalHours, hourly, apr: toApr(hourly), nextFundingTime: Number(raw.nextFundingTime) || 0 };
}

const keyOf = (venue: string): VenueKey | null =>
  venue === VENUE_IDS.hl ? 'hl' : venue === VENUE_IDS.bin ? 'bin' : venue === VENUE_IDS.bybit ? 'bybit' : null;

/** Rows from a raw `predictedFundings` answer. Malformed entries are skipped, unknown venues ignored. */
export function parsePredictedFundings(raw: unknown): FundingCompareRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FundingCompareRow[] = [];
  for (const entry of raw as unknown[]) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    const [coin, venues] = entry as [string, unknown];
    const row: FundingCompareRow = { coin, hl: null, bin: null, bybit: null, spread: { bin: null, bybit: null }, best: null };
    if (Array.isArray(venues)) {
      for (const v of venues as unknown[]) {
        if (!Array.isArray(v) || typeof v[0] !== 'string') continue;
        const key = keyOf(v[0]);
        if (key) row[key] = normalizeVenue(v[0], v[1] as RawVenueFunding | null);
      }
    }
    for (const k of OTHER_VENUES) {
      const other = row[k];
      if (!row.hl || !other) continue;
      const spread = row.hl.apr - other.apr;
      row.spread[k] = spread;
      if (!row.best || Math.abs(spread) > Math.abs(row.best.spread)) row.best = { venue: k, spread };
    }
    out.push(row);
  }
  return out;
}

/**
 * Which side to take on each venue to collect the spread: short where funding
 * is higher (shorts receive positive funding), long where it is lower.
 * Null when there is no comparison or the spread is below `minApr`.
 */
export function arbHint(row: FundingCompareRow, minApr = ARB_MIN_APR): ArbHint | null {
  if (!row.best || Math.abs(row.best.spread) < minApr) return null;
  const { venue, spread } = row.best;
  return spread > 0 ? { long: venue, short: 'hl', spreadApr: spread } : { long: 'hl', short: venue, spreadApr: -spread };
}

/** Absolute best spread for sorting (NaN, which sorts last, when nothing is comparable). */
export const absSpread = (row: FundingCompareRow) => (row.best ? Math.abs(row.best.spread) : NaN);

/** Fetch and normalise predicted fundings (weight 20). */
export async function fetchPredictedFundings(priority: number = Priority.User, signal?: AbortSignal): Promise<FundingCompareRow[]> {
  const raw = await info<RawPredictedFundings>({ type: 'predictedFundings' }, { weight: 20, priority, signal });
  return parsePredictedFundings(raw);
}
