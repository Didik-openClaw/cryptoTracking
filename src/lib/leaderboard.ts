import { LEADERBOARD_URL } from './api';
import { num } from './format';
import { load, save } from './storage';
import type { PerfWindow, SeedAccount } from './types';

/**
 * Hyperliquid has no "list every big position" endpoint, so the scanner needs
 * a list of addresses to check. The public leaderboard (every account with its
 * account value and PnL) is that list. Sources, in order of preference:
 *  1. a fresh copy cached in localStorage,
 *  2. `data/leaderboard.json` produced at build time by scripts/fetch-leaderboard.mjs
 *     (same origin, small, refreshed by the scheduled GitHub Pages deploy),
 *  3. the live leaderboard straight from stats-data.hyperliquid.xyz,
 *  4. any stale copy we still have.
 */

export const MAX_SEEDS = 8000;
const CACHE_FRESH_MS = 30 * 60_000;
const BUNDLE_FRESH_MS = 6 * 60 * 60_000;

/**
 * Compact row: [address, accountValue, displayName,
 *   pnlDay, pnlWeek, pnlMonth, pnlAllTime, vlmMonth,
 *   roiDay, roiWeek, roiMonth, roiAllTime, vlmDay, vlmWeek, vlmAllTime]
 * (older files stop after vlmMonth; missing values read as 0).
 */
export type CompactRow = [string, number, string | null, ...number[]];

export interface SeedFile {
  generatedAt: number;
  rows: CompactRow[];
}

export type SeedSource = 'cache' | 'bundled' | 'direct' | 'stale';

export interface SeedResult {
  accounts: SeedAccount[];
  source: SeedSource;
  generatedAt: number;
}

interface RawRow {
  ethAddress: string;
  accountValue: string;
  displayName?: string | null;
  windowPerformances?: [string, { pnl: string; roi: string; vlm: string }][];
}

const WINDOWS: PerfWindow[] = ['day', 'week', 'month', 'allTime'];
const perWindow = (f: (w: PerfWindow) => number) =>
  Object.fromEntries(WINDOWS.map((w) => [w, f(w)])) as Record<PerfWindow, number>;

/** Accept either the raw Hyperliquid leaderboard JSON or our compact file. */
export function parseLeaderboard(json: unknown): SeedAccount[] {
  if (!json || typeof json !== 'object') return [];
  const obj = json as { leaderboardRows?: RawRow[]; rows?: CompactRow[] };
  if (Array.isArray(obj.rows)) return obj.rows.map(fromCompact);
  if (!Array.isArray(obj.leaderboardRows)) return [];
  return obj.leaderboardRows
    .filter((r) => typeof r?.ethAddress === 'string')
    .map((r) => {
      const w = new Map((r.windowPerformances ?? []).map(([k, v]) => [k, v]));
      return {
        address: r.ethAddress.toLowerCase(),
        accountValue: num(r.accountValue),
        displayName: r.displayName || null,
        pnl: perWindow((k) => num(w.get(k)?.pnl)),
        roi: perWindow((k) => num(w.get(k)?.roi)),
        vlm: perWindow((k) => num(w.get(k)?.vlm)),
      };
    });
}

export function toCompact(a: SeedAccount): CompactRow {
  const r = (v: number) => Math.round(v);
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  return [
    a.address,
    r(a.accountValue),
    a.displayName,
    r(a.pnl.day),
    r(a.pnl.week),
    r(a.pnl.month),
    r(a.pnl.allTime),
    r(a.vlm.month),
    r4(a.roi.day),
    r4(a.roi.week),
    r4(a.roi.month),
    r4(a.roi.allTime),
    r(a.vlm.day),
    r(a.vlm.week),
    r(a.vlm.allTime),
  ];
}

function fromCompact(r: CompactRow): SeedAccount {
  const n = (i: number) => num(r[i] as number);
  return {
    address: String(r[0]).toLowerCase(),
    accountValue: n(1),
    displayName: (r[2] as string | null) || null,
    pnl: { day: n(3), week: n(4), month: n(5), allTime: n(6) },
    roi: { day: n(8), week: n(9), month: n(10), allTime: n(11) },
    vlm: { day: n(12), week: n(13), month: n(7), allTime: n(14) },
  };
}

export function topAccounts(accounts: SeedAccount[], limit = MAX_SEEDS): SeedAccount[] {
  return [...accounts].sort((a, b) => b.accountValue - a.accountValue).slice(0, limit);
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function cache(accounts: SeedAccount[], generatedAt: number): void {
  // Keep the cache small enough for localStorage (~5MB budget shared).
  save('seeds2', { generatedAt, rows: topAccounts(accounts, 6000).map(toCompact) } satisfies SeedFile);
}

export async function loadSeeds(forceLive = false, log: (msg: string) => void = () => {}): Promise<SeedResult> {
  const now = Date.now();
  const cached = load<SeedFile | null>('seeds2', null);
  if (!forceLive && cached && now - cached.generatedAt < CACHE_FRESH_MS && cached.rows.length) {
    return { accounts: parseLeaderboard(cached), source: 'cache', generatedAt: cached.generatedAt };
  }

  let bundled: SeedResult | null = null;
  try {
    const json = (await fetchJson('./data/leaderboard.json', 20_000)) as SeedFile;
    const accounts = parseLeaderboard(json);
    if (accounts.length) bundled = { accounts, source: 'bundled', generatedAt: json.generatedAt || 0 };
  } catch {
    /* file absent in dev or when the build-time fetch failed */
  }
  if (!forceLive && bundled && now - bundled.generatedAt < BUNDLE_FRESH_MS) {
    cache(bundled.accounts, bundled.generatedAt);
    return bundled;
  }

  try {
    log('Mengunduh leaderboard Hyperliquid langsung (file besar, bisa 10–60 detik)…');
    const json = await fetchJson(LEADERBOARD_URL, 120_000);
    const accounts = topAccounts(parseLeaderboard(json));
    if (accounts.length) {
      cache(accounts, now);
      return { accounts, source: 'direct', generatedAt: now };
    }
  } catch (e) {
    log(`Leaderboard langsung gagal dimuat (${(e as Error).message}).`);
  }

  if (bundled) return { ...bundled, source: 'stale' };
  if (cached?.rows.length) return { accounts: parseLeaderboard(cached), source: 'stale', generatedAt: cached.generatedAt };
  throw new Error('Leaderboard tidak bisa dimuat dari sumber mana pun.');
}
