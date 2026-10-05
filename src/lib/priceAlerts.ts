import { fmtPct, fmtPx } from './format';
import { tr } from './i18n';
import { market } from './market';
import { notifier } from './notify';
import { Observable } from './observable';
import { load, save } from './storage';

/**
 * Price alerts on live mid prices: a level crossed upwards or downwards, or a
 * move of at least X % within the last N minutes. Kept in localStorage and
 * checked on every market update while the terminal is open.
 */
export type AlertKind = 'above' | 'below' | 'pctMove';

export interface PriceAlert {
  id: string;
  coin: string;
  kind: AlertKind;
  /** Level for above / below. */
  price?: number;
  /** Percent (1 = 1 %) for pctMove. */
  pct?: number;
  /** Minutes for pctMove. */
  windowMin?: number;
  note?: string;
  createdAt: number;
  triggeredAt?: number;
  /** Price (or move) that set it off. */
  triggeredPx?: number;
  repeat: boolean;
  active: boolean;
}

export interface Sample {
  t: number;
  px: number;
}

const MAX_ALERTS = 200;
const HISTORY_MS = 4 * 3_600_000;
const SAMPLE_EVERY_MS = 10_000;

/** True when the price moved from `prev` to `cur` across `level` in the alert's direction. */
export function crossed(kind: 'above' | 'below', level: number, prev: number | undefined, cur: number): boolean {
  if (prev === undefined || !(level > 0) || !(cur > 0)) return false;
  return kind === 'above' ? prev < level && cur >= level : prev > level && cur <= level;
}

/**
 * Change from the oldest sample inside the window to `cur`, or null while the
 * history covers less than half the window (just opened, nothing to compare).
 */
export function windowMove(history: Sample[], now: number, windowMs: number, cur: number): number | null {
  if (!history.length || !(cur > 0)) return null;
  const from = now - windowMs;
  const base = history.find((h) => h.t >= from);
  if (!base || now - base.t < windowMs / 2) return null;
  return cur / base.px - 1;
}

/** Append a sample at most every SAMPLE_EVERY_MS and drop samples older than HISTORY_MS. */
export function addSample(history: Sample[], now: number, px: number): Sample[] {
  const last = history[history.length - 1];
  const next = last && now - last.t < SAMPLE_EVERY_MS ? history : [...history, { t: now, px }];
  const from = now - HISTORY_MS;
  return next[0] && next[0].t < from ? next.filter((h) => h.t >= from) : next;
}

export function describeAlert(a: PriceAlert): string {
  if (a.kind === 'above') return tr(`${a.coin} naik ke ${fmtPx(a.price)}`, `${a.coin} rises to ${fmtPx(a.price)}`);
  if (a.kind === 'below') return tr(`${a.coin} turun ke ${fmtPx(a.price)}`, `${a.coin} falls to ${fmtPx(a.price)}`);
  return tr(`${a.coin} bergerak ≥ ${a.pct}% dalam ${a.windowMin} menit`, `${a.coin} moves ≥ ${a.pct}% within ${a.windowMin} min`);
}

const isAlert = (a: unknown): a is PriceAlert => {
  const x = a as PriceAlert;
  return !!x && typeof x.id === 'string' && typeof x.coin === 'string' && ['above', 'below', 'pctMove'].includes(x.kind);
};

class PriceAlerts extends Observable {
  alerts: PriceAlert[] = (load<unknown[]>('priceAlerts', []) ?? []).filter(isAlert);
  private prev = new Map<string, number>();
  private history = new Map<string, Sample[]>();
  private started = false;

  constructor() {
    super(0);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    market.subscribe(() => this.check());
  }

  add(a: Omit<PriceAlert, 'id' | 'createdAt' | 'active'>): PriceAlert {
    const alert: PriceAlert = { ...a, id: Math.random().toString(36).slice(2, 10), createdAt: Date.now(), active: true };
    this.alerts = [alert, ...this.alerts].slice(0, MAX_ALERTS);
    this.persist();
    return alert;
  }

  remove(id: string): void {
    this.alerts = this.alerts.filter((a) => a.id !== id);
    this.persist();
  }

  rearm(id: string): void {
    this.alerts = this.alerts.map((a) => (a.id === id ? { ...a, active: true, triggeredAt: undefined, triggeredPx: undefined } : a));
    this.persist();
  }

  clearTriggered(): void {
    this.alerts = this.alerts.filter((a) => a.active);
    this.persist();
  }

  forCoin(coin?: string): PriceAlert[] {
    return coin ? this.alerts.filter((a) => a.coin === coin) : this.alerts;
  }

  /** Runs on every market update: compares each active alert with the latest mid price. */
  private check(): void {
    const now = Date.now();
    const coins = new Set(this.alerts.filter((a) => a.active).map((a) => a.coin));
    let changed = false;
    for (const coin of coins) {
      const cur = market.mids.get(coin);
      if (!cur) continue;
      const prev = this.prev.get(coin);
      const history = addSample(this.history.get(coin) ?? [], now, cur);
      this.history.set(coin, history);
      for (const a of this.alerts) {
        if (!a.active || a.coin !== coin) continue;
        let hit: number | null = null;
        if (a.kind === 'pctMove') {
          // A repeating move alert waits a full window before it can fire again.
          if (a.triggeredAt && now - a.triggeredAt < (a.windowMin ?? 15) * 60_000) continue;
          const move = windowMove(history, now, (a.windowMin ?? 15) * 60_000, cur);
          if (move !== null && Math.abs(move) * 100 >= (a.pct ?? 0)) hit = move;
        } else if (crossed(a.kind, a.price ?? 0, prev, cur)) {
          hit = cur;
        }
        if (hit === null) continue;
        a.triggeredAt = now;
        a.triggeredPx = hit;
        a.active = a.repeat;
        changed = true;
        this.notify(a, cur);
      }
      this.prev.set(coin, cur);
    }
    if (changed) this.persist();
  }

  private notify(a: PriceAlert, cur: number): void {
    const body =
      a.kind === 'pctMove'
        ? tr(
            `${fmtPct(a.triggeredPx ?? 0, { sign: true })} dalam ${a.windowMin} menit · sekarang ${fmtPx(cur)}`,
            `${fmtPct(a.triggeredPx ?? 0, { sign: true })} within ${a.windowMin} min · now ${fmtPx(cur)}`,
          )
        : tr(`Harga sekarang ${fmtPx(cur)}`, `Price now ${fmtPx(cur)}`);
    notifier.push({
      title: `${tr('ALERT HARGA', 'PRICE ALERT')} · ${describeAlert(a)}`,
      body: a.note ? `${body} · ${a.note}` : body,
      severity: 'warn',
      href: `#/coin/${encodeURIComponent(a.coin)}`,
    });
  }

  private persist(): void {
    save('priceAlerts', this.alerts);
    this.emit(true);
  }
}

export const priceAlerts = new PriceAlerts();
