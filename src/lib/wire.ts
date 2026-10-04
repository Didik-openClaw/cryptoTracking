import { fmtPct, fmtPx, fmtSize, fmtUsd } from './format';
import { tr } from './i18n';
import { live } from './live';
import { market } from './market';
import { Observable } from './observable';
import { scanner } from './scanner';
import { settings } from './settings';

/**
 * "WIRE": a terminal-style stream of market events built from Hyperliquid data
 * the app already receives. Block trades, new whale positions, sharp price
 * moves, extreme funding, open-interest jumps and whales close to
 * liquidation.
 */
export type WireKind = 'block' | 'whale' | 'move' | 'funding' | 'oi' | 'liq';
export type WireTone = 'pos' | 'neg' | 'warn' | 'info';

export interface WireEvent {
  id: string;
  time: number;
  kind: WireKind;
  coin: string;
  title: string;
  detail: string;
  tone: WireTone;
  address?: string;
}

/** Short tag for each event kind, in the current language. */
export const wireLabel = (kind: WireKind): string =>
  ({
    block: tr('BLOK', 'BLOCK'),
    whale: 'WHALE',
    move: tr('HARGA', 'PRICE'),
    funding: 'FUNDING',
    oi: 'OI',
    liq: tr('LIKUIDASI', 'LIQ'),
  })[kind];

/** Same tags as `wireLabel`, read live (getters) so `WIRE_LABEL[kind]` follows the language too. */
export const WIRE_LABEL: Readonly<Record<WireKind, string>> = {
  get block() {
    return wireLabel('block');
  },
  get whale() {
    return wireLabel('whale');
  },
  get move() {
    return wireLabel('move');
  },
  get funding() {
    return wireLabel('funding');
  },
  get oi() {
    return wireLabel('oi');
  },
  get liq() {
    return wireLabel('liq');
  },
};

const MAX_EVENTS = 300;
const SAMPLE_MS = 15_000;
const MOVE_WINDOW_MS = 15 * 60_000;
const MOVE_PCT_MAJOR = 0.015; // the five most traded perps
const MOVE_PCT = 0.03;
const MOVE_COOLDOWN_MS = 15 * 60_000;
const OI_WINDOW_MS = 30 * 60_000;
const OI_PCT = 0.06;
const OI_MIN_USD = 5e6;
const OI_COOLDOWN_MS = 60 * 60_000;
const FUNDING_EXTREME = 0.0001; // 0.01% per hour ≈ 88% APR
const FUNDING_REARM = 0.00007;
const LIQ_NEAR = 0.03;
const LIQ_REARM = 0.05;

/** Relative change from the newest sample at least `windowMs` old to the latest one. */
export function changeOver(hist: [number, number][], now: number, windowMs: number): number | null {
  if (hist.length < 2) return null;
  let base: number | null = null;
  for (const [t, v] of hist) {
    if (t <= now - windowMs) base = v;
    else break;
  }
  const latest = hist[hist.length - 1][1];
  return base && base > 0 ? latest / base - 1 : null;
}

/** Track a value with hysteresis: true once when it enters the zone, re-armed when it clearly leaves. */
export function crossing(armed: Map<string, boolean>, key: string, inZone: boolean, outOfZone: boolean): boolean {
  const isArmed = armed.get(key) ?? true;
  if (inZone && isArmed) {
    armed.set(key, false);
    return true;
  }
  if (outOfZone) armed.set(key, true);
  return false;
}

class Wire extends Observable {
  events: WireEvent[] = [];
  private seq = 0;
  private prices = new Map<string, [number, number][]>();
  private oi = new Map<string, [number, number][]>();
  private lastMove = new Map<string, number>();
  private lastOi = new Map<string, number>();
  private fundingArmed = new Map<string, boolean>();
  private liqArmed = new Map<string, boolean>();
  private marketSeen = 0;
  private started = false;

  constructor() {
    super(400);
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    live.onBigTrade((t) => {
      const w = scanner.wallets.get(t.taker);
      const p = w?.positions.find((x) => x.coin === t.coin);
      const pos = p ? `${p.side === 'long' ? 'LONG' : 'SHORT'} ${fmtUsd(p.positionValue)}` : '';
      const holding = p ? tr(` · sekarang ${pos}`, ` · now ${pos}`) : '';
      const fills = tr(`${t.fills} fill`, `${t.fills} fill${t.fills === 1 ? '' : 's'}`);
      this.push({
        kind: 'block',
        coin: t.coin,
        tone: t.side === 'buy' ? 'pos' : 'neg',
        title: `${t.side === 'buy' ? tr('Beli', 'Buy') : tr('Jual', 'Sell')} ${t.coin} ${fmtUsd(t.notional)}`,
        detail: `${fmtSize(t.size)} @ ${fmtPx(t.avgPx)} · ${fills}${holding} ·`,
        address: t.taker,
        time: t.time,
      });
    });

    scanner.onNewWhale(({ address, position: p }) => {
      if (p.positionValue < settings.value.minPositionUsd) return;
      this.push({
        kind: 'whale',
        coin: p.coin,
        tone: p.side === 'long' ? 'pos' : 'neg',
        title: `${tr('Posisi baru', 'New')} ${p.side === 'long' ? 'LONG' : 'SHORT'} ${p.coin} ${fmtUsd(p.positionValue)}`,
        detail: `Entry ${fmtPx(p.entryPx)} · ${p.leverage}x · ${tr('likuidasi', 'Liq.')} ${fmtPx(p.liquidationPx)} ·`,
        address,
      });
    });

    market.subscribe(() => {
      if (market.loadedAt !== this.marketSeen) {
        this.marketSeen = market.loadedAt;
        this.onMarketRefresh();
      }
    });
    setInterval(() => this.sample(), SAMPLE_MS);
  }

  private push(e: Omit<WireEvent, 'id' | 'time'> & { time?: number }): void {
    this.events = [{ ...e, id: `w${++this.seq}`, time: e.time ?? Date.now() }, ...this.events].slice(0, MAX_EVENTS);
    this.emit();
  }

  /** Price moves and liquidation proximity, every 15 seconds. */
  private sample(): void {
    const now = Date.now();
    const top = market.topCoins(40);
    const majors = new Set(top.slice(0, 5));
    for (const coin of top) {
      const px = market.mids.get(coin);
      if (!px) continue;
      const hist = this.prices.get(coin) ?? [];
      hist.push([now, px]);
      while (hist.length && hist[0][0] < now - MOVE_WINDOW_MS - 5 * 60_000) hist.shift();
      this.prices.set(coin, hist);
      const chg = changeOver(hist, now, MOVE_WINDOW_MS);
      const limit = majors.has(coin) ? MOVE_PCT_MAJOR : MOVE_PCT;
      if (chg !== null && Math.abs(chg) >= limit && now - (this.lastMove.get(coin) ?? 0) > MOVE_COOLDOWN_MS) {
        this.lastMove.set(coin, now);
        this.push({
          kind: 'move',
          coin,
          tone: chg > 0 ? 'pos' : 'neg',
          title: tr(
            `${coin} ${chg > 0 ? 'naik' : 'turun'} ${fmtPct(Math.abs(chg), { decimals: 1 })} dalam 15 menit`,
            `${coin} ${chg > 0 ? 'up' : 'down'} ${fmtPct(Math.abs(chg), { decimals: 1 })} in 15 min`,
          ),
          detail: `${tr('Sekarang', 'Now')} ${fmtPx(px)}`,
        });
      }
    }

    for (const p of scanner.livePositions(market.mids, settings.value.minPositionUsd)) {
      const key = `${p.address}|${p.coin}|${p.side}`;
      const d = p.liqDistance;
      if (crossing(this.liqArmed, key, d !== null && d < LIQ_NEAR, d === null || d > LIQ_REARM)) {
        const pos = `${p.side === 'long' ? 'LONG' : 'SHORT'} ${p.coin} ${fmtUsd(p.notional)} ${fmtPct(d, { decimals: 1 })}`;
        this.push({
          kind: 'liq',
          coin: p.coin,
          tone: 'warn',
          title: tr(`${pos} dari likuidasi`, `${pos} from liquidation`),
          detail: `Mark ${fmtPx(p.mark)} · ${tr('likuidasi', 'Liq.')} ${fmtPx(p.liquidationPx)} · ${p.leverage}x ·`,
          address: p.address,
        });
      }
    }
  }

  /** Funding and open interest, on every asset-context refresh (about once a minute). */
  private onMarketRefresh(): void {
    const now = Date.now();
    for (const coin of market.topCoins(40)) {
      const c = market.coins.get(coin);
      if (!c) continue;
      const f = c.funding;
      if (crossing(this.fundingArmed, coin, Math.abs(f) >= FUNDING_EXTREME, Math.abs(f) < FUNDING_REARM)) {
        this.push({
          kind: 'funding',
          coin,
          tone: 'warn',
          title: tr(
            `Funding ${coin} ekstrem ${fmtPct(f, { decimals: 4, sign: true })}/jam`,
            `Extreme ${coin} funding ${fmtPct(f, { decimals: 4, sign: true })}/h`,
          ),
          detail: `${fmtPct(f * 24 * 365, { decimals: 0, sign: true })} APR · ${
            f > 0
              ? tr('long membayar short (long ramai)', 'longs pay shorts (crowded long)')
              : tr('short membayar long (short ramai)', 'shorts pay longs (crowded short)')
          }`,
        });
      }

      const hist = this.oi.get(coin) ?? [];
      hist.push([now, c.openInterestUsd]);
      while (hist.length && hist[0][0] < now - OI_WINDOW_MS - 10 * 60_000) hist.shift();
      this.oi.set(coin, hist);
      const chg = changeOver(hist, now, OI_WINDOW_MS);
      if (chg === null || Math.abs(chg) < OI_PCT || now - (this.lastOi.get(coin) ?? 0) < OI_COOLDOWN_MS) continue;
      const deltaUsd = c.openInterestUsd - c.openInterestUsd / (1 + chg);
      if (Math.abs(deltaUsd) < OI_MIN_USD) continue;
      this.lastOi.set(coin, now);
      this.push({
        kind: 'oi',
        coin,
        tone: chg > 0 ? 'info' : 'warn',
        title: tr(
          `Open interest ${coin} ${chg > 0 ? 'naik' : 'turun'} ${fmtPct(Math.abs(chg), { decimals: 1 })} dalam 30 menit`,
          `${coin} open interest ${chg > 0 ? 'up' : 'down'} ${fmtPct(Math.abs(chg), { decimals: 1 })} in 30 min`,
        ),
        detail: `${fmtUsd(deltaUsd, { sign: true })} → ${fmtUsd(c.openInterestUsd)} · ${
          chg > 0 ? tr('posisi baru masuk', 'new positions opening') : tr('posisi ditutup / dilikuidasi', 'positions closed / liquidated')
        }`,
      });
    }
  }
}

export const wire = new Wire();
