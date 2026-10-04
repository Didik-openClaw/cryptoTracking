import { fmtPct, fmtPx, fmtSize, fmtUsd } from './format';
import { liqDistance } from './positions';
import type { Position, WalletSnapshot } from './types';

export type AlertKind = 'open' | 'close' | 'increase' | 'decrease' | 'flip' | 'liq' | 'trade' | 'whale' | 'bigtrade';

export interface AlertEvent {
  kind: AlertKind;
  coin: string;
  title: string;
  body: string;
  severity: 'info' | 'warn' | 'danger';
}

export interface DiffOpts {
  sizeChangePct: number; // e.g. 10 = alert when size changes by >= 10%
  liqPct: number; // e.g. 5 = alert when mark is within 5% of liquidation
}

const sideLabel = (p: Position) => (p.side === 'long' ? 'LONG' : 'SHORT');
const markOf = (p: Position) => (p.size > 0 ? p.positionValue / p.size : p.entryPx);
const describe = (p: Position) =>
  `${fmtSize(p.size)} ${p.coin} (${fmtUsd(p.positionValue)}) · entry ${fmtPx(p.entryPx)} · ${p.leverage}x ${p.leverageType}`;

/** Re-arm the liquidation alert once the position moves this much further away. */
const LIQ_HYSTERESIS = 0.02;

/**
 * Compare two snapshots of the same wallet and describe what changed.
 * `liqArmed` (coin → armed) persists between calls so a position hovering
 * near liquidation alerts once rather than on every poll.
 */
export function diffSnapshots(
  prev: WalletSnapshot,
  curr: WalletSnapshot,
  opts: DiffOpts,
  liqArmed: Map<string, boolean>,
): AlertEvent[] {
  const events: AlertEvent[] = [];
  const before = new Map(prev.positions.map((p) => [p.coin, p]));
  const after = new Map(curr.positions.map((p) => [p.coin, p]));

  for (const [coin, p] of after) {
    const b = before.get(coin);
    if (!b) {
      events.push({ kind: 'open', coin, severity: 'info', title: `Buka ${sideLabel(p)} ${coin}`, body: describe(p) });
    } else if (b.side !== p.side) {
      events.push({
        kind: 'flip',
        coin,
        severity: 'warn',
        title: `Balik arah ${sideLabel(b)} → ${sideLabel(p)} ${coin}`,
        body: describe(p),
      });
    } else if (b.size > 0) {
      const rel = (p.size - b.size) / b.size;
      if (Math.abs(rel) * 100 >= opts.sizeChangePct) {
        const up = rel > 0;
        events.push({
          kind: up ? 'increase' : 'decrease',
          coin,
          severity: 'info',
          title: `${up ? 'Tambah' : 'Kurangi'} ${sideLabel(p)} ${coin} ${fmtPct(rel, { sign: true, decimals: 1 })}`,
          body: `${fmtSize(b.size)} → ${describe(p)}`,
        });
      }
    }

    const dist = liqDistance(p.side, markOf(p), p.liquidationPx);
    const armed = liqArmed.get(coin) ?? true;
    if (dist !== null && dist * 100 < opts.liqPct) {
      if (armed) {
        events.push({
          kind: 'liq',
          coin,
          severity: 'danger',
          title: `${sideLabel(p)} ${coin} dekat likuidasi (${fmtPct(dist)})`,
          body: `Mark ${fmtPx(markOf(p))} · likuidasi ${fmtPx(p.liquidationPx)} · ${describe(p)}`,
        });
        liqArmed.set(coin, false);
      }
    } else if (dist === null || dist * 100 > opts.liqPct + LIQ_HYSTERESIS * 100) {
      liqArmed.set(coin, true);
    }
  }

  for (const [coin, b] of before) {
    if (after.has(coin)) continue;
    liqArmed.delete(coin);
    events.push({
      kind: 'close',
      coin,
      severity: 'info',
      title: `Tutup ${sideLabel(b)} ${coin}`,
      body: `${fmtSize(b.size)} ${coin} (${fmtUsd(b.positionValue)}) · uPnL terakhir ${fmtUsd(b.unrealizedPnl, { sign: true })}`,
    });
  }
  return events;
}
