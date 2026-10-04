import { useMemo, useState, type ReactNode } from 'react';
import { fmtPct, fmtUsd, pnlClass } from '../lib/format';
import type { Side } from '../lib/types';

export function SideBadge({ side }: { side: Side | 'buy' | 'sell' }) {
  const cls = side === 'long' || side === 'buy' ? 'long' : 'short';
  const label = { long: 'LONG', short: 'SHORT', buy: 'BELI', sell: 'JUAL' }[side];
  return <span className={`side ${cls}`}>{label}</span>;
}

export function Pnl({ v, pct, compact = true }: { v: number; pct?: number; compact?: boolean }) {
  return (
    <span className={pnlClass(v)}>
      {fmtUsd(v, { sign: true, compact })}
      {pct !== undefined && <span className="small"> ({fmtPct(pct, { sign: true, decimals: 1 })})</span>}
    </span>
  );
}

export function LiqDist({ d }: { d: number | null }) {
  if (d === null) return <span className="dim">–</span>;
  const cls = d < 0.05 ? 'danger' : d < 0.15 ? 'warn' : 'muted';
  return <span className={cls}>{fmtPct(d, { decimals: 1 })}</span>;
}

export function LongShortBar({ long, short, big }: { long: number; short: number; big?: boolean }) {
  const total = long + short;
  const lp = total > 0 ? (long / total) * 100 : 50;
  return (
    <div
      className={`ls-bar${big ? ' big' : ''}`}
      title={`Long ${lp.toFixed(1)}% · Short ${(100 - lp).toFixed(1)}%`}
    >
      <div className="l" style={{ width: `${lp}%` }} />
      <div className="s" style={{ width: `${100 - lp}%` }} />
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone,
  extra,
  onClick,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'long' | 'short' | 'danger';
  extra?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <div className={`card${tone ? ' ' + tone : ''}${onClick ? ' clickable' : ''}`} onClick={onClick}>
      <div className="label">
        <span>{label}</span>
        {extra}
      </div>
      <div className="value">{value}</div>
      {sub !== undefined && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="memuat" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: ReactNode; cls?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className={`${o.value === value ? 'on' : ''} ${o.cls ?? ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  tabs,
  onChange,
}: {
  value: T;
  tabs: { id: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} type="button" className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined && <span className="tag">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export const USD_PRESETS = [100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000];

export function UsdSelect({
  value,
  onChange,
  presets = USD_PRESETS,
}: {
  value: number;
  onChange: (v: number) => void;
  presets?: number[];
}) {
  const opts = presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b);
  return (
    <select className="input" value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {opts.map((v) => (
        <option key={v} value={v}>
          ≥ {fmtUsd(v, { decimals: v % 1_000_000 === 0 || v < 1_000_000 ? 0 : 1 })}
        </option>
      ))}
    </select>
  );
}

// ---- sortable tables ----

export type SortDir = 'asc' | 'desc';

export function useSort<T, K extends string>(
  rows: T[],
  getters: Record<K, (r: T) => number | string>,
  initial: NoInfer<K>,
  initialDir: SortDir = 'desc',
) {
  const [key, setKey] = useState<K>(initial);
  const [dir, setDir] = useState<SortDir>(initialDir);
  const sorted = useMemo(() => {
    const g = getters[key];
    const m = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = g(a);
      const y = g(b);
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * m;
      // Missing values (NaN/Infinity used as sentinels) always sort last.
      const xf = Number.isFinite(x);
      const yf = Number.isFinite(y);
      if (!xf || !yf) return xf === yf ? 0 : xf ? -1 : 1;
      return (x - y) * m;
    });
    // `getters` is a static table definition, so it is not a dependency.
  }, [rows, key, dir]);
  const toggle = (k: K) => {
    if (k === key) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setKey(k);
      setDir('desc');
    }
  };
  // A render helper rather than a component: a component defined inside the
  // hook would get a new identity every render and remount its header cells.
  const th = (k: K, label: ReactNode, opts: { num?: boolean; title?: string } = {}) => (
    <th key={k} className={`sortable${opts.num ? ' num' : ''}`} onClick={() => toggle(k)} title={opts.title}>
      {label}
      {k === key && <span className="arrow">{dir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );
  return { sorted, key, dir, toggle, th };
}
