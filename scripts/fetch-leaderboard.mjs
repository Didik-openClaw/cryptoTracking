#!/usr/bin/env node
// Downloads the public Hyperliquid leaderboard at build time and writes a
// compact copy to public/data/leaderboard.json, served next to the site.
// The browser then gets the list of accounts to scan from its own origin
// (small, fast, no CORS concerns). Failure is not fatal: the site falls back
// to fetching the leaderboard directly in the browser.
import { mkdir, writeFile } from 'node:fs/promises';

const LEADERBOARD_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';
const OUT_DIR = new URL('../public/data/', import.meta.url);
const MAX_ROWS = 8000;
const MIN_ACCOUNT_VALUE = 10_000;

const n = (v) => {
  const x = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(x) ? x : 0;
};

try {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120_000);
  const res = await fetch(LEADERBOARD_URL, { signal: ctl.signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  clearTimeout(timer);
  const rows = (json.leaderboardRows ?? [])
    .filter((r) => typeof r?.ethAddress === 'string' && n(r.accountValue) >= MIN_ACCOUNT_VALUE)
    .map((r) => {
      const w = Object.fromEntries(r.windowPerformances ?? []);
      // [address, accountValue, displayName, pnlDay, pnlWeek, pnlMonth, pnlAllTime, vlmMonth]
      return [
        r.ethAddress.toLowerCase(),
        Math.round(n(r.accountValue)),
        r.displayName || null,
        Math.round(n(w.day?.pnl)),
        Math.round(n(w.week?.pnl)),
        Math.round(n(w.month?.pnl)),
        Math.round(n(w.allTime?.pnl)),
        Math.round(n(w.month?.vlm)),
      ];
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ROWS);
  if (!rows.length) throw new Error('leaderboard kosong');
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(new URL('leaderboard.json', OUT_DIR), JSON.stringify({ generatedAt: Date.now(), rows }));
  console.log(`[leaderboard] ${rows.length} akun ditulis ke public/data/leaderboard.json`);
} catch (e) {
  console.warn(`[leaderboard] dilewati (${e.message}); situs akan mengambil leaderboard langsung dari browser.`);
}
