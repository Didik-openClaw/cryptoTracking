// Number formatting follows the convention traders see on exchanges
// ($1.25M, 12.5K); labels and dates are Indonesian.

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
  }
  return `${s}$${a.toLocaleString('en-US', { minimumFractionDigits: decimals ?? 2, maximumFractionDigits: decimals ?? 2 })}`;
}

/** Price with precision adapted to magnitude (BTC 61,234.5 vs PEPE 0.000012345). */
export function fmtPx(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return '–';
  const a = Math.abs(v);
  let d = 2;
  if (a < 0.0001) d = 8;
  else if (a < 0.01) d = 6;
  else if (a < 1) d = 5;
  else if (a < 10) d = 4;
  else if (a < 1000) d = 3;
  else if (a < 10000) d = 2;
  else d = 1;
  return v.toLocaleString('en-US', { minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d });
}

export function fmtSize(v: number): string {
  const a = Math.abs(v);
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

const dtf = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const tf = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function fmtDateTime(ms: number): string {
  return dtf.format(new Date(ms));
}

export function fmtTime(ms: number): string {
  return tf.format(new Date(ms));
}

export function fmtAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s} dtk lalu`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt lalu`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} jam lalu`;
  return `${Math.round(h / 24)} hari lalu`;
}

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} mnt ${s % 60} dtk`;
  return `${Math.floor(m / 60)} jam ${m % 60} mnt`;
}

export function pnlClass(v: number): string {
  return v > 0 ? 'pos' : v < 0 ? 'neg' : '';
}
