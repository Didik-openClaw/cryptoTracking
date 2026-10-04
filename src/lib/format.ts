import { locale, tr } from './i18n';

// Number formatting follows the convention traders see on exchanges
// ($1.25M, 12.5K) in both languages; labels and dates follow the interface language.

const pad2 = (n: number) => String(n).padStart(2, '0');

export function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export function fmtUsd(v: number, opts: { compact?: boolean; sign?: boolean; decimals?: number } = {}): string {
  const { compact = true, sign = false, decimals } = opts;
  if (!Number.isFinite(v)) return '–';
  const s = sign && v > 0 ? '+' : v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (compact) {
    if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(decimals ?? 2)}B`;
    if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(decimals ?? 2)}M`;
    if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(decimals ?? 1)}K`;
    if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(decimals ?? 2)}K`;
  }
  return `${s}$${a.toLocaleString('en-US', { minimumFractionDigits: decimals ?? 2, maximumFractionDigits: decimals ?? 2 })}`;
}

/** Decimals worth showing for a price of this magnitude. */
export function pxDecimals(v: number): number {
  const a = Math.abs(v);
  if (a < 0.0001) return 8;
  if (a < 0.01) return 6;
  if (a < 1) return 5;
  if (a < 10) return 4;
  if (a < 1000) return 3;
  if (a < 10000) return 2;
  return 1;
}

/** Price with precision adapted to magnitude (BTC 61,234.5 vs PEPE 0.000012345). */
export function fmtPx(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return '–';
  const d = pxDecimals(v);
  return v.toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
}

export function fmtSize(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

export function fmtPct(v: number | null | undefined, opts: { sign?: boolean; decimals?: number } = {}): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const { sign = false, decimals = 2 } = opts;
  const p = v * 100;
  return `${sign && p > 0 ? '+' : ''}${p.toFixed(decimals)}%`;
}

export function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function isAddress(a: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(a.trim());
}

/** "02 Okt 2026 14:05" / "02 Oct 2026 14:05" in the viewer's timezone. */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())} ${monthName(d.getMonth())} ${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** "09:03:25" in the viewer's timezone. */
export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short month name in the interface language (0 = January). */
export const monthName = (m: number) => tr(MONTHS_ID, MONTHS_EN)[m];

/** "02 Okt 14:05" in the viewer's timezone (colon, unlike id-ID's "14.05"). */
export function fmtShortDateTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getDate())} ${monthName(d.getMonth())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Compact age: 45m, 3j 20m, 2hr 5j, 41hr (m = menit, j = jam, hr = hari); English: 45m, 3h 20m, 2d 5h. */
export function fmtAge(ms: number, now = Date.now()): string {
  const [H, D] = tr(['j', 'hr'], ['h', 'd']);
  const m = Math.max(0, Math.floor((now - ms) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${H} ${m % 60}m`;
  const d = Math.floor(h / 24);
  return d < 30 ? `${d}${D} ${h % 24}${H}` : `${d}${D}`;
}

/** A duration in the same compact units as fmtAge. */
export const fmtSpan = (ms: number | null | undefined) => (ms == null ? '–' : fmtAge(0, ms));

/** Profit factor: "1.85", "∞" when nothing was lost, "–" when unknown. */
export function fmtPF(pf: number | null | undefined): string {
  if (pf === null || pf === undefined) return '–';
  return pf === Infinity ? '∞' : pf.toFixed(2);
}
export const pfClass = (pf: number | null | undefined) => (pf == null ? '' : pf >= 1.5 ? 'pos' : pf < 1 ? 'neg' : '');
export const wrClass = (wr: number | null | undefined) => (wr == null ? '' : wr >= 0.55 ? 'pos' : wr < 0.45 ? 'neg' : '');

export function fmtAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return tr(`${s} dtk lalu`, `${s}s ago`);
  const m = Math.round(s / 60);
  if (m < 60) return tr(`${m} mnt lalu`, `${m} min ago`);
  const h = Math.round(m / 60);
  if (h < 48) return tr(`${h} jam lalu`, `${h}h ago`);
  const d = Math.round(h / 24);
  return tr(`${d} hari lalu`, `${d}d ago`);
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return tr(`${s} dtk`, `${s}s`);
  const m = Math.floor(s / 60);
  if (m < 60) return tr(`${m} mnt ${s % 60} dtk`, `${m}m ${s % 60}s`);
  return tr(`${Math.floor(m / 60)} jam ${m % 60} mnt`, `${Math.floor(m / 60)}h ${m % 60}m`);
}

/** Count with the interface language's digit grouping (1.234 / 1,234). */
export const fmtCount = (n: number) => n.toLocaleString(locale());

export function pnlClass(v: number): string {
  return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
}
