/**
 * Technical indicators over candles. Pure functions; every output line is
 * aligned with the input bars and holds null until enough bars are available.
 * Formulas follow TradingView's built-ins (Wilder smoothing for RSI/ATR/ADX,
 * population standard deviation for Bollinger Bands, SMA-seeded EMA), so the
 * values match what traders see elsewhere.
 */

export interface Bar {
  time: number; // seconds (chart time)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Line = (number | null)[];

export type Source = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';
export const SOURCES: Source[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];

export function pick(bars: Bar[], src: Source): number[] {
  return bars.map((b) => {
    switch (src) {
      case 'open':
        return b.open;
      case 'high':
        return b.high;
      case 'low':
        return b.low;
      case 'hl2':
        return (b.high + b.low) / 2;
      case 'hlc3':
        return (b.high + b.low + b.close) / 3;
      case 'ohlc4':
        return (b.open + b.high + b.low + b.close) / 4;
      default:
        return b.close;
    }
  });
}

const empty = (n: number): Line => new Array<number | null>(n).fill(null);

/** Combine two aligned lines point by point (null where either is null). */
export function zip(a: Line, b: Line, f: (x: number, y: number) => number): Line {
  return a.map((x, i) => (x == null || b[i] == null ? null : f(x, b[i] as number)));
}

/** Simple moving average. */
export function sma(values: Line, n: number): Line {
  const out = empty(values.length);
  let sum = 0;
  let run = 0; // consecutive non-null values
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      sum = 0;
      run = 0;
      continue;
    }
    sum += v;
    run++;
    if (run > n) {
      sum -= values[i - n] as number;
      run = n;
    }
    if (run === n) out[i] = sum / n;
  }
  return out;
}

/** Exponential smoothing seeded with the SMA of the first `n` values. */
function smooth(values: Line, n: number, alpha: number): Line {
  const out = empty(values.length);
  let prev: number | null = null;
  let seed = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev === null) {
      seed += v;
      if (++count === n) out[i] = prev = seed / n;
      continue;
    }
    out[i] = prev = alpha * v + (1 - alpha) * prev;
  }
  return out;
}

export const ema = (values: Line, n: number) => smooth(values, n, 2 / (n + 1));
/** Wilder's moving average (RSI, ATR, ADX). */
export const rma = (values: Line, n: number) => smooth(values, n, 1 / n);

/** Linearly weighted moving average. */
export function wma(values: Line, n: number): Line {
  const out = empty(values.length);
  const denom = (n * (n + 1)) / 2;
  outer: for (let i = n - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const v = values[i - j];
      if (v == null) continue outer;
      sum += v * (n - j);
    }
    out[i] = sum / denom;
  }
  return out;
}

export type MaType = 'sma' | 'ema' | 'wma';
export const ma = (type: MaType, values: Line, n: number) => (type === 'ema' ? ema(values, n) : type === 'wma' ? wma(values, n) : sma(values, n));

/** Highest/lowest value over the last `n` points (null if the window has a gap). */
function rolling(values: Line, n: number, f: (a: number, b: number) => number): Line {
  const out = empty(values.length);
  outer: for (let i = n - 1; i < values.length; i++) {
    let acc = values[i];
    if (acc == null) continue;
    for (let j = 1; j < n; j++) {
      const v = values[i - j];
      if (v == null) continue outer;
      acc = f(acc, v);
    }
    out[i] = acc;
  }
  return out;
}
export const highest = (values: Line, n: number) => rolling(values, n, Math.max);
export const lowest = (values: Line, n: number) => rolling(values, n, Math.min);

export function bollinger(values: number[], n: number, mult: number) {
  const basis = sma(values, n);
  const dev = basis.map((m, i) => {
    if (m == null) return null;
    let s = 0;
    for (let j = 0; j < n; j++) s += (values[i - j] - m) ** 2;
    return Math.sqrt(s / n);
  });
  return { basis, upper: zip(basis, dev, (m, d) => m + mult * d), lower: zip(basis, dev, (m, d) => m - mult * d) };
}

export type Anchor = 'day' | 'week' | 'month';

/** Volume-weighted average price, restarting each UTC day/week (Monday)/month. */
export function vwap(bars: Bar[], anchor: Anchor): Line {
  let pv = 0;
  let vol = 0;
  let period = '';
  return bars.map((b) => {
    const d = new Date(b.time * 1000);
    const day = Math.floor(b.time / 86_400);
    const key =
      anchor === 'month' ? `${d.getUTCFullYear()}-${d.getUTCMonth()}` : String(anchor === 'week' ? Math.floor((day + 3) / 7) : day);
    if (key !== period) {
      period = key;
      pv = 0;
      vol = 0;
    }
    const tp = (b.high + b.low + b.close) / 3;
    pv += tp * b.volume;
    vol += b.volume;
    return vol > 0 ? pv / vol : tp;
  });
}

export function rsi(values: Line, n: number): Line {
  const gains = empty(values.length);
  const losses = empty(values.length);
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if (a == null || b == null) continue;
    gains[i] = Math.max(b - a, 0);
    losses[i] = Math.max(a - b, 0);
  }
  return zip(rma(gains, n), rma(losses, n), (g, l) => (l === 0 ? 100 : g === 0 ? 0 : 100 - 100 / (1 + g / l)));
}

export function macd(values: number[], fast: number, slow: number, signalLen: number) {
  const line = zip(ema(values, fast), ema(values, slow), (f, s) => f - s);
  const signal = ema(line, signalLen);
  return { macd: line, signal, hist: zip(line, signal, (m, s) => m - s) };
}

/** %K/%D of `values` within their own range (Stochastic of price, or of RSI for Stoch RSI). */
function stochOf(close: Line, high: Line, low: Line, kLen: number, kSmooth: number, dSmooth: number) {
  const hh = highest(high, kLen);
  const ll = lowest(low, kLen);
  const raw = close.map((c, i) => {
    const h = hh[i];
    const l = ll[i];
    if (c == null || h == null || l == null) return null;
    return h === l ? 50 : (100 * (c - l)) / (h - l);
  });
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dSmooth) };
}

export const stoch = (bars: Bar[], kLen: number, kSmooth: number, dSmooth: number) =>
  stochOf(
    bars.map((b) => b.close),
    bars.map((b) => b.high),
    bars.map((b) => b.low),
    kLen,
    kSmooth,
    dSmooth,
  );

export function stochRsi(values: number[], rsiLen: number, stochLen: number, kSmooth: number, dSmooth: number) {
  const r = rsi(values, rsiLen);
  return stochOf(r, r, r, stochLen, kSmooth, dSmooth);
}

export function trueRange(bars: Bar[]): Line {
  return bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
}

export const atr = (bars: Bar[], n: number) => rma(trueRange(bars), n);

/** Directional movement: ADX with +DI / −DI. */
export function adx(bars: Bar[], n: number) {
  const plusDm = empty(bars.length);
  const minusDm = empty(bars.length);
  const tr = empty(bars.length);
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const down = bars[i - 1].low - bars[i].low;
    plusDm[i] = up > down && up > 0 ? up : 0;
    minusDm[i] = down > up && down > 0 ? down : 0;
    const pc = bars[i - 1].close;
    tr[i] = Math.max(bars[i].high - bars[i].low, Math.abs(bars[i].high - pc), Math.abs(bars[i].low - pc));
  }
  const trS = rma(tr, n);
  const plus = zip(rma(plusDm, n), trS, (d, t) => (t === 0 ? 0 : (100 * d) / t));
  const minus = zip(rma(minusDm, n), trS, (d, t) => (t === 0 ? 0 : (100 * d) / t));
  const dx = zip(plus, minus, (p, m) => (p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m)));
  return { adx: rma(dx, n), plus, minus };
}

export function obv(bars: Bar[]): Line {
  let acc = 0;
  return bars.map((b, i) => {
    if (i > 0) acc += b.close > bars[i - 1].close ? b.volume : b.close < bars[i - 1].close ? -b.volume : 0;
    return acc;
  });
}

export function cci(bars: Bar[], n: number): Line {
  const tp = pick(bars, 'hlc3');
  const mean = sma(tp, n);
  return mean.map((m, i) => {
    if (m == null) return null;
    let dev = 0;
    for (let j = 0; j < n; j++) dev += Math.abs(tp[i - j] - m);
    dev /= n;
    return dev === 0 ? 0 : (tp[i] - m) / (0.015 * dev);
  });
}

/** Supertrend line and trend (1 = up, −1 = down), as TradingView's ta.supertrend. */
export function supertrend(bars: Bar[], n: number, mult: number) {
  const a = atr(bars, n);
  const value = empty(bars.length);
  const trend: (1 | -1 | null)[] = new Array(bars.length).fill(null);
  let lower = 0;
  let upper = 0;
  let prevValue: number | null = null;
  for (let i = 0; i < bars.length; i++) {
    const r = a[i];
    if (r == null) continue;
    const mid = (bars[i].high + bars[i].low) / 2;
    let lo = mid - mult * r;
    let up = mid + mult * r;
    const prevClose = i > 0 ? bars[i - 1].close : bars[i].close;
    if (prevValue !== null) {
      lo = lo > lower || prevClose < lower ? lo : lower;
      up = up < upper || prevClose > upper ? up : upper;
    }
    let t: 1 | -1;
    if (prevValue === null) t = -1;
    else if (prevValue === upper) t = bars[i].close > up ? 1 : -1;
    else t = bars[i].close < lo ? -1 : 1;
    lower = lo;
    upper = up;
    value[i] = prevValue = t === 1 ? lo : up;
    trend[i] = t;
  }
  return { value, trend };
}

/** Parabolic SAR (Wilder). */
export function psar(bars: Bar[], start: number, step: number, max: number): Line {
  const out = empty(bars.length);
  if (bars.length < 3) return out;
  let up = bars[1].close >= bars[0].close;
  let sar = up ? Math.min(bars[0].low, bars[1].low) : Math.max(bars[0].high, bars[1].high);
  let ep = up ? Math.max(bars[0].high, bars[1].high) : Math.min(bars[0].low, bars[1].low);
  let af = start;
  for (let i = 2; i < bars.length; i++) {
    const b = bars[i];
    sar += af * (ep - sar);
    if (up) {
      sar = Math.min(sar, bars[i - 1].low, bars[i - 2].low);
      if (b.low < sar) {
        up = false;
        sar = ep;
        ep = b.low;
        af = start;
      } else if (b.high > ep) {
        ep = b.high;
        af = Math.min(af + step, max);
      }
    } else {
      sar = Math.max(sar, bars[i - 1].high, bars[i - 2].high);
      if (b.high > sar) {
        up = true;
        sar = ep;
        ep = b.high;
        af = start;
      } else if (b.low < ep) {
        ep = b.low;
        af = Math.min(af + step, max);
      }
    }
    out[i] = sar;
  }
  return out;
}

/**
 * Ichimoku. Senkou spans are shifted `displacement - 1` bars into the future
 * and the lagging span the same number of bars back, as TradingView plots
 * them; `shift` tells the caller how far.
 */
export function ichimoku(bars: Bar[], conv: number, base: number, spanBLen: number, displacement: number) {
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const mid = (n: number) => zip(highest(high, n), lowest(low, n), (h, l) => (h + l) / 2);
  const tenkan = mid(conv);
  const kijun = mid(base);
  return {
    tenkan,
    kijun,
    spanA: zip(tenkan, kijun, (a, b) => (a + b) / 2),
    spanB: mid(spanBLen),
    chikou: bars.map((b) => b.close),
    shift: Math.max(0, displacement - 1),
  };
}
