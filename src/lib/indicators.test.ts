import { describe, expect, it } from 'vitest';
import {
  adx,
  atr,
  bollinger,
  cci,
  ema,
  ichimoku,
  macd,
  obv,
  psar,
  rsi,
  sma,
  stoch,
  stochRsi,
  supertrend,
  vwap,
  wma,
  type Bar,
} from './indicators';

const bar = (i: number, close: number, spread = 1, volume = 10): Bar => ({
  time: 1_700_000_000 + i * 3600,
  open: close,
  high: close + spread,
  low: close - spread,
  close,
  volume,
});
const rising = (n: number) => Array.from({ length: n }, (_, i) => bar(i, 100 + i));
const round = (v: number | null | undefined, d = 6) => (v == null ? v : Number(v.toFixed(d)));

describe('moving averages', () => {
  it('sma, ema and wma', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(round(wma([1, 2, 3], 3)[2])).toBe(round(14 / 6));
    // EMA is seeded with the SMA of the first n values, then smooths with 2/(n+1).
    const e = ema([2, 4, 6, 8], 3);
    expect(e.slice(0, 3)).toEqual([null, null, 4]);
    expect(e[3]).toBe(0.5 * 8 + 0.5 * 4);
    expect(ema([null, null, 5, 5, 5, 5], 2)).toEqual([null, null, null, 5, 5, 5]);
  });

  it('bollinger bands collapse on a flat series and widen with volatility', () => {
    const flat = bollinger([5, 5, 5, 5], 3, 2);
    expect(flat.upper[3]).toBe(5);
    expect(flat.lower[3]).toBe(5);
    const b = bollinger([1, 3, 1, 3], 2, 2);
    expect(b.basis[3]).toBe(2);
    expect(b.upper[3]).toBe(4); // population stdev of [1,3] is 1
    expect(b.lower[3]).toBe(0);
  });
});

describe('oscillators', () => {
  it('rsi is 100 when only rising, 0 when only falling, 50 when balanced', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 3)[5]).toBe(100);
    expect(rsi([6, 5, 4, 3, 2, 1], 3)[5]).toBe(0);
    expect(rsi([1, 2, 1, 2, 1, 2, 1], 2)[6]).toBeGreaterThan(30);
    expect(rsi([1, 2, 1, 2, 1], 4)[4]).toBe(50);
    expect(rsi([1, 2, 3], 3)).toEqual([null, null, null]);
  });

  it('macd is zero on a flat series and positive in an uptrend', () => {
    const flat = macd(new Array(40).fill(10), 12, 26, 9);
    expect(flat.macd[39]).toBe(0);
    expect(flat.hist[39]).toBe(0);
    const up = macd(Array.from({ length: 60 }, (_, i) => 100 + i * i * 0.1), 12, 26, 9);
    expect(up.macd[59]).toBeGreaterThan(0);
    expect(up.signal[33]).not.toBeNull();
    expect(up.signal[32]).toBeNull(); // 26 bars for the slow EMA, then 9 for the signal
  });

  it('stochastic is 100 at the top of the range; stoch rsi stays within 0–100', () => {
    const bars = rising(30).map((b) => ({ ...b, high: b.close, low: b.close - 5 }));
    const s = stoch(bars, 14, 1, 3);
    expect(s.k[29]).toBe(100);
    expect(s.d[29]).toBe(100);
    const sr = stochRsi(Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 3) * 5), 14, 14, 3, 3);
    const vals = sr.k.filter((v): v is number => v != null);
    expect(vals.length).toBeGreaterThan(20);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...vals)).toBeLessThanOrEqual(100 + 1e-9);
  });

  it('cci is zero on a flat series', () => {
    expect(cci(Array.from({ length: 25 }, (_, i) => bar(i, 50)), 20)[24]).toBe(0);
  });
});

describe('volatility, volume and trend', () => {
  it('atr equals the bar range when bars do not gap', () => {
    expect(atr(Array.from({ length: 20 }, (_, i) => bar(i, 50, 2)), 14)[19]).toBe(4);
  });

  it('obv adds volume on up closes and subtracts on down closes', () => {
    const bars = [bar(0, 10, 1, 5), bar(1, 11, 1, 7), bar(2, 9, 1, 3), bar(3, 9, 1, 100)];
    expect(obv(bars)).toEqual([0, 7, 4, 4]);
  });

  it('vwap restarts each UTC day', () => {
    const day = 86_400;
    const t0 = 1_700_006_400 - (1_700_006_400 % day); // midnight UTC
    const bars: Bar[] = [
      { time: t0, open: 10, high: 10, low: 10, close: 10, volume: 1 },
      { time: t0 + 3600, open: 20, high: 20, low: 20, close: 20, volume: 3 },
      { time: t0 + day, open: 40, high: 40, low: 40, close: 40, volume: 2 },
    ];
    expect(vwap(bars, 'day')).toEqual([10, 17.5, 40]);
    expect(vwap(bars, 'month')[2]).toBe((10 + 60 + 80) / 6);
  });

  it('adx shows a strong uptrend with +DI above −DI', () => {
    const r = adx(rising(60), 14);
    expect(r.plus[59]!).toBeGreaterThan(r.minus[59]!);
    expect(r.adx[59]!).toBeGreaterThan(50);
  });

  it('supertrend and parabolic SAR sit below price in an uptrend', () => {
    const bars = rising(50);
    const st = supertrend(bars, 10, 3);
    expect(st.trend[49]).toBe(1);
    expect(st.value[49]!).toBeLessThan(bars[49].low);
    const sar = psar(bars, 0.02, 0.02, 0.2);
    expect(sar[49]!).toBeLessThan(bars[49].low);
  });

  it('supertrend flips down after a crash', () => {
    const bars = [...rising(30), ...Array.from({ length: 10 }, (_, i) => bar(30 + i, 80 - i * 3))];
    expect(supertrend(bars, 10, 3).trend[39]).toBe(-1);
  });

  it('ichimoku lines use the midpoint of the high/low range', () => {
    const bars = rising(60);
    const ich = ichimoku(bars, 9, 26, 52, 26);
    // Tenkan at bar 59: highest high of bars 51..59 = 160, lowest low = 150 → 155.
    expect(ich.tenkan[59]).toBe(155);
    expect(ich.spanB[50]).toBeNull();
    expect(ich.spanB[51]).not.toBeNull();
    expect(ich.shift).toBe(25);
  });
});
