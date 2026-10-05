import { describe, expect, it } from 'vitest';
import type { CoinInfo } from './market';
import { filterRows, heat, median, screenRows, summarize, TOP_BY_VOLUME } from './marketScreen';

function coin(name: string, o: Partial<CoinInfo> = {}): CoinInfo {
  return {
    coin: name,
    mark: 100,
    oracle: 100,
    prevDayPx: 100,
    funding: 0.0000125,
    openInterest: 1000,
    openInterestUsd: 100_000,
    dayVolumeUsd: 1_000_000,
    maxLeverage: 10,
    szDecimals: 2,
    delisted: false,
    ...o,
  };
}

describe('screenRows', () => {
  it('uses live mids, skips delisted coins and derives ratios', () => {
    const rows = screenRows(
      [
        coin('BTC', { mark: 100, oracle: 99.5, prevDayPx: 90, openInterest: 50, dayVolumeUsd: 2500 }),
        coin('OLD', { delisted: true }),
        coin('ZERO', { dayVolumeUsd: 0, oracle: 0 }),
      ],
      new Map([['BTC', 110]]),
    );
    expect(rows.map((r) => r.coin)).toEqual(['BTC', 'ZERO']);
    const btc = rows[0];
    expect(btc.mark).toBe(110);
    expect(btc.change).toBeCloseTo(110 / 90 - 1, 12);
    expect(btc.oiUsd).toBe(5500);
    expect(btc.oiVol).toBeCloseTo(2.2, 12);
    expect(btc.basis).toBeCloseTo(100 / 99.5 - 1, 12);
    expect(btc.apr).toBeCloseTo(0.0000125 * 8760, 12);
    expect(Number.isNaN(rows[1].oiVol)).toBe(true);
    expect(Number.isNaN(rows[1].basis)).toBe(true);
  });
});

describe('summarize', () => {
  it('totals OI and volume, averages funding and counts extremes', () => {
    const rows = screenRows(
      [
        coin('A', { funding: 0.0001, openInterest: 10 }), // 87.6% APR, OI $1,000
        coin('B', { funding: -0.00006, openInterest: 30 }), // -52.6% APR, OI $3,000
        coin('C', { funding: 0.00001, openInterest: 60 }), // OI $6,000
      ],
      new Map(),
    );
    const s = summarize(rows);
    expect(s.count).toBe(3);
    expect(s.totalOi).toBe(10_000);
    expect(s.totalVolume).toBe(3_000_000);
    expect(s.avgFunding).toBeCloseTo((0.0001 - 0.00006 + 0.00001) / 3, 12);
    expect(s.medianFunding).toBe(0.00001);
    expect(s.oiWeightedFunding).toBeCloseTo((0.0001 * 1000 - 0.00006 * 3000 + 0.00001 * 6000) / 10_000, 12);
    expect([s.positive, s.negative, s.extremePos, s.extremeNeg]).toEqual([2, 1, 1, 1]);
    expect(s.biggest?.coin).toBe('C');
  });

  it('is empty-safe', () => {
    const s = summarize([]);
    expect(s.count).toBe(0);
    expect(s.biggest).toBeNull();
    expect(Number.isNaN(s.avgFunding)).toBe(true);
  });
});

describe('median', () => {
  it('handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
});

describe('filterRows', () => {
  const rows = screenRows(
    Array.from({ length: 40 }, (_, i) => coin(`C${i}`, { dayVolumeUsd: (i + 1) * 1000, funding: i % 2 ? 0.00001 : -0.00001 })),
    new Map(),
  );

  it('searches coin names case-insensitively', () => {
    expect(filterRows(rows, 'all', ' c3').map((r) => r.coin)).toEqual(['C3', 'C30', 'C31', 'C32', 'C33', 'C34', 'C35', 'C36', 'C37', 'C38', 'C39']);
  });

  it('splits by funding sign', () => {
    expect(filterRows(rows, 'pos', '').every((r) => r.funding > 0)).toBe(true);
    expect(filterRows(rows, 'neg', '')).toHaveLength(20);
  });

  it('keeps the top coins by volume, ranked over the whole market', () => {
    const top = filterRows(rows, 'top', '');
    expect(top).toHaveLength(TOP_BY_VOLUME);
    expect(top.some((r) => r.coin === 'C0')).toBe(false);
    expect(filterRows(rows, 'top', 'C1').map((r) => r.coin)).toEqual(['C10', 'C11', 'C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19']);
  });
});

describe('heat', () => {
  it('scales and clamps intensity', () => {
    expect(heat(0.05, 0.1)).toBe(0.5);
    expect(heat(-0.3, 0.1)).toBe(1);
    expect(heat(NaN, 0.1)).toBe(0);
  });
});
