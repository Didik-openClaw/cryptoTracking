import { useEffect, useState } from 'react';
import { info, Priority } from './api';
import { num } from './format';

/**
 * Order book (L2) for one perp: the `l2Book` request, pure analysis (mid,
 * spread, depth bands, imbalance, whale walls) and a polling hook.
 *
 * Hyperliquid returns at most 20 levels per side. With `nSigFigs` (2–5) prices
 * are aggregated to that many significant figures, so the same 20 levels reach
 * further from the mid: full precision shows the top of the book, 3–4 sig figs
 * show the walls a few percent away.
 */

// ---- API shapes ----

export interface HLBookLevel {
  px: string;
  sz: string;
  /** Number of orders resting at this level. */
  n: number;
}

export interface HLL2Book {
  coin: string;
  time: number;
  /** [bids best-first (descending), asks best-first (ascending)] */
  levels: [HLBookLevel[], HLBookLevel[]];
}

// ---- parsed book ----

export type BookSide = 'bid' | 'ask';

export interface BookLevel {
  px: number;
  /** Size in coins. */
  sz: number;
  n: number;
  /** px × sz */
  usd: number;
  /** Cumulative size from the best level out to this one (inclusive). */
  cumSz: number;
  cumUsd: number;
}

export interface Book {
  coin: string;
  time: number;
  /** Aggregation the book was requested with (null = full precision). */
  nSigFigs: number | null;
  /** Most decimals any price string carried, so a ladder can align its prices. */
  pxDecimals: number;
  bids: BookLevel[];
  asks: BookLevel[];
}

/** Levels per side Hyperliquid returns; a side with fewer levels is the whole side. */
export const BOOK_LEVELS = 20;
/** Weight of one l2Book request in Hyperliquid's rate limit. */
export const BOOK_WEIGHT = 2;
export const BOOK_POLL_MS = 3_000;
/** Distances from mid (as fractions) the depth summary reports. */
export const DEPTH_BANDS = [0.005, 0.01, 0.02];
export const SIG_FIGS = [2, 3, 4, 5];
export const WALL_MIN_USD = 1_000_000;
/** A wall must also be this many times the median level in the book. */
export const WALL_MEDIAN_MULT = 3;

export function getL2Book(coin: string, nSigFigs: number | null = null, priority: number = Priority.User, signal?: AbortSignal) {
  return info<HLL2Book | null>(
    { type: 'l2Book', coin, ...(nSigFigs ? { nSigFigs } : {}) },
    { weight: BOOK_WEIGHT, priority, signal },
  );
}

function decimalsOf(px: string): number {
  const i = px.indexOf('.');
  return i < 0 ? 0 : px.length - i - 1;
}

/** Adds USD value and running totals to levels already ordered best-first. */
export function withCumulative(levels: { px: number; sz: number; n: number }[]): BookLevel[] {
  let cumSz = 0;
  let cumUsd = 0;
  return levels.map((l) => {
    const usd = l.px * l.sz;
    cumSz += l.sz;
    cumUsd += usd;
    return { px: l.px, sz: l.sz, n: l.n, usd, cumSz, cumUsd };
  });
}

/** Parses an l2Book response; null when the coin has no book. Levels are re-sorted best-first defensively. */
export function parseBook(raw: HLL2Book | null | undefined, nSigFigs: number | null = null): Book | null {
  if (!raw || !Array.isArray(raw.levels)) return null;
  const [rawBids = [], rawAsks = []] = raw.levels;
  let pxDecimals = 0;
  const side = (levels: HLBookLevel[], desc: boolean) =>
    withCumulative(
      levels
        .map((l) => {
          pxDecimals = Math.max(pxDecimals, decimalsOf(String(l.px)));
          return { px: num(l.px), sz: num(l.sz), n: Number(l.n) || 0 };
        })
        .filter((l) => l.px > 0 && l.sz > 0)
        .sort((a, b) => (desc ? b.px - a.px : a.px - b.px)),
    );
  const bids = side(rawBids, true);
  const asks = side(rawAsks, false);
  return { coin: raw.coin, time: Number(raw.time) || 0, nSigFigs, pxDecimals: Math.min(pxDecimals, 10), bids, asks };
}

// ---- analysis ----

/** Midpoint of the best bid and ask; the best price of the only side when one is empty; null for an empty book. */
export function bookMid(book: Book): number | null {
  const b = book.bids[0]?.px;
  const a = book.asks[0]?.px;
  if (b && a) return (a + b) / 2;
  return b ?? a ?? null;
}

export interface Spread {
  /** Best ask − best bid, in price units. */
  abs: number;
  /** abs / mid in basis points. */
  bps: number;
}

export function bookSpread(book: Book): Spread | null {
  const b = book.bids[0]?.px;
  const a = book.asks[0]?.px;
  if (!b || !a) return null;
  const abs = a - b;
  return { abs, bps: (abs / ((a + b) / 2)) * 1e4 };
}

/**
 * Mid used to measure distances. An aggregated book's own mid can sit half a
 * bucket off (bids round down, asks round up), so the live mid from allMids is
 * preferred when it falls between the aggregated best bid and ask.
 */
export function referenceMid(book: Book, liveMid?: number | null): number | null {
  const mid = bookMid(book);
  if (!book.nSigFigs || !liveMid || !(liveMid > 0)) return mid;
  const b = book.bids[0]?.px ?? 0;
  const a = book.asks[0]?.px ?? Infinity;
  return liveMid >= b && liveMid <= a ? liveMid : mid;
}

/** (bid − ask) / (bid + ask): +1 all bids, −1 all asks, 0 balanced or empty. */
export function imbalance(bid: number, ask: number): number {
  const total = bid + ask;
  return total > 0 ? (bid - ask) / total : 0;
}

const EPS = 1e-9;
const distance = (px: number, mid: number) => Math.abs(px - mid) / mid;

export interface DepthBand {
  /** Half-width of the band as a fraction of mid (0.01 = ±1%). */
  pct: number;
  bidUsd: number;
  askUsd: number;
  imbalance: number;
  /**
   * False when the returned levels stop inside the band, so the depth shown is
   * a lower bound (the side had 20 levels and the last one is closer than pct).
   */
  bidComplete: boolean;
  askComplete: boolean;
}

function sideDepth(levels: BookLevel[], mid: number, pct: number): { usd: number; complete: boolean } {
  let usd = 0;
  for (const l of levels) if (distance(l.px, mid) <= pct + EPS) usd += l.usd;
  const last = levels[levels.length - 1];
  const complete = levels.length < BOOK_LEVELS || (!!last && distance(last.px, mid) >= pct - EPS);
  return { usd, complete };
}

/** USD resting within ±pct of mid on each side. */
export function depthWithin(book: Book, pct: number, mid: number | null = bookMid(book)): DepthBand {
  if (!mid) return { pct, bidUsd: 0, askUsd: 0, imbalance: 0, bidComplete: false, askComplete: false };
  const bid = sideDepth(book.bids, mid, pct);
  const ask = sideDepth(book.asks, mid, pct);
  return {
    pct,
    bidUsd: bid.usd,
    askUsd: ask.usd,
    imbalance: imbalance(bid.usd, ask.usd),
    bidComplete: bid.complete,
    askComplete: ask.complete,
  };
}

export function depthBands(book: Book, mid: number | null = bookMid(book), pcts: readonly number[] = DEPTH_BANDS): DepthBand[] {
  return pcts.map((p) => depthWithin(book, p, mid));
}

/** How far from mid (fraction) the farthest returned level on each side sits. */
export function bookReach(book: Book, mid: number | null = bookMid(book)): { bid: number; ask: number } {
  const far = (ls: BookLevel[]) => (mid && ls.length ? distance(ls[ls.length - 1].px, mid) : 0);
  return { bid: far(book.bids), ask: far(book.asks) };
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median USD size of all levels in the book (both sides). */
export const medianLevelUsd = (book: Book) => median([...book.bids, ...book.asks].map((l) => l.usd));

export interface WallOpts {
  /** Minimum level size in USD (default $1M). */
  minUsd?: number;
  /** Minimum multiple of the median level size (default 3). */
  medianMult?: number;
  /** Mid to measure distance from (default: the book's own mid). */
  mid?: number | null;
}

/** USD size a level needs to count as a wall: the larger of minUsd and medianMult × median level. */
export function wallCutoff(book: Book, opts: WallOpts = {}): number {
  return Math.max(opts.minUsd ?? WALL_MIN_USD, medianLevelUsd(book) * (opts.medianMult ?? WALL_MEDIAN_MULT));
}

export interface Wall {
  side: BookSide;
  px: number;
  sz: number;
  usd: number;
  n: number;
  /** Distance from mid as a positive fraction (0.012 = 1.2% away). */
  distance: number;
}

/** Levels at or above the wall cutoff on both sides, nearest to mid first. */
export function findWalls(book: Book, opts: WallOpts = {}): Wall[] {
  const cut = wallCutoff(book, opts);
  const mid = opts.mid ?? bookMid(book);
  const pick = (levels: BookLevel[], side: BookSide): Wall[] =>
    levels
      .filter((l) => l.usd >= cut)
      .map((l) => ({ side, px: l.px, sz: l.sz, usd: l.usd, n: l.n, distance: mid ? distance(l.px, mid) : 0 }));
  return [...pick(book.bids, 'bid'), ...pick(book.asks, 'ask')].sort((a, b) => a.distance - b.distance || b.usd - a.usd);
}

export interface BookAnalysis {
  mid: number | null;
  spread: Spread | null;
  bands: DepthBand[];
  walls: Wall[];
  wallCut: number;
  medianUsd: number;
  reach: { bid: number; ask: number };
}

/** Everything the order book panel shows, in one pass. */
export function analyzeBook(book: Book, opts: { wallUsd?: number; liveMid?: number | null } = {}): BookAnalysis {
  const mid = referenceMid(book, opts.liveMid);
  const wallOpts = { minUsd: opts.wallUsd ?? WALL_MIN_USD, mid };
  return {
    mid,
    spread: bookSpread(book),
    bands: depthBands(book, mid),
    walls: findWalls(book, wallOpts),
    wallCut: wallCutoff(book, wallOpts),
    medianUsd: medianLevelUsd(book),
    reach: bookReach(book, mid),
  };
}

// ---- polling hook ----

export interface OrderBookState {
  book: Book | null;
  /** Last fetch error (the previous book is kept). */
  error: string;
  /** When the current book arrived (ms), 0 before the first one. */
  updatedAt: number;
  /** True while the precision just changed and the shown book is still the previous one. */
  pending: boolean;
}

interface Stored {
  coin: string;
  key: string;
  book: Book | null;
  error: string;
  updatedAt: number;
}

const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

/**
 * Polls l2Book every 3 s while mounted and the tab is visible (weight 2 per
 * request, ~40 weight/min). The first request, and the first after the tab
 * comes back, run at user priority; the rest at watch priority. Requests run
 * one at a time, the next one 3 s after the previous answer.
 */
export function useOrderBook(coin: string, nSigFigs: number | null = null): OrderBookState {
  const key = `${coin}|${nSigFigs ?? 0}`;
  const [s, set] = useState<Stored>({ coin: '', key: '', book: null, error: '', updatedAt: 0 });

  useEffect(() => {
    if (!coin) return;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let first = true;

    const poll = async () => {
      timer = undefined;
      if (ctl.signal.aborted || running || !visible()) return;
      running = true;
      try {
        const raw = await getL2Book(coin, nSigFigs, first ? Priority.User : Priority.Watch, ctl.signal);
        if (ctl.signal.aborted) return;
        const book = parseBook(raw, nSigFigs);
        if (!book) throw new Error('no book');
        first = false;
        set({ coin, key, book, error: '', updatedAt: Date.now() });
      } catch (e) {
        if (ctl.signal.aborted || (e as Error).name === 'AbortError') return;
        const msg = (e as Error).message;
        set((p) => (p.key === key ? { ...p, error: msg } : { coin, key, book: p.coin === coin ? p.book : null, error: msg, updatedAt: 0 }));
      } finally {
        running = false;
      }
      if (!ctl.signal.aborted && visible()) timer = setTimeout(poll, BOOK_POLL_MS);
    };

    const onVisibility = () => {
      if (!visible() || running || timer !== undefined) return;
      first = true; // the book shown is stale: refresh at user priority
      void poll();
    };

    document.addEventListener('visibilitychange', onVisibility);
    void poll();
    return () => {
      ctl.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [coin, nSigFigs, key]);

  if (s.key === key) return { book: s.book, error: s.error, updatedAt: s.updatedAt, pending: false };
  // Precision changed: keep showing the previous book of the same coin until the new one lands.
  if (s.coin === coin && s.book) return { book: s.book, error: '', updatedAt: s.updatedAt, pending: true };
  return { book: null, error: '', updatedAt: 0, pending: false };
}
