import { describe, expect, it } from 'vitest';
import { analyzeBook, bookMid, bookSpread, depthWithin, findWalls, imbalance, parseBook, referenceMid, type HLL2Book } from './orderbook';

const raw: HLL2Book = {
  coin: 'BTC',
  time: 1,
  levels: [
    [
      { px: '99.9', sz: '10', n: 2 },
      { px: '99.5', sz: '20000', n: 9 }, // $1.99M wall
      { px: '98', sz: '5', n: 1 },
    ],
    [
      { px: '100.1', sz: '10', n: 3 },
      { px: '101', sz: '10', n: 1 },
      { px: '103', sz: '15000', n: 4 }, // $1.545M wall, 2.9 % away
    ],
  ],
};

describe('order book', () => {
  const book = parseBook(raw)!;

  it('parses levels best-first with USD and running totals', () => {
    expect(book.bids.map((l) => l.px)).toEqual([99.9, 99.5, 98]);
    expect(book.asks.map((l) => l.px)).toEqual([100.1, 101, 103]);
    expect(book.bids[1].usd).toBeCloseTo(1_990_000);
    expect(book.bids[2].cumUsd).toBeCloseTo(999 + 1_990_000 + 490);
    expect(book.pxDecimals).toBe(1);
    expect(parseBook(null)).toBeNull();
  });

  it('computes mid, spread and imbalance', () => {
    expect(bookMid(book)).toBeCloseTo(100);
    const s = bookSpread(book)!;
    expect(s.abs).toBeCloseTo(0.2);
    expect(s.bps).toBeCloseTo(20);
    expect(imbalance(3, 1)).toBe(0.5);
    expect(imbalance(0, 0)).toBe(0);
  });

  it('sums depth inside a band around mid', () => {
    const d = depthWithin(book, 0.01, 100);
    expect(d.bidUsd).toBeCloseTo(999 + 1_990_000);
    expect(d.askUsd).toBeCloseTo(1001 + 1010);
    expect(d.imbalance).toBeGreaterThan(0.99);
    expect(d.bidComplete).toBe(true); // fewer than 20 levels: the whole side is known
  });

  it('finds walls by size and distance', () => {
    const walls = findWalls(book, { minUsd: 1_000_000, mid: 100 });
    expect(walls.map((w) => [w.side, w.px])).toEqual([
      ['bid', 99.5],
      ['ask', 103],
    ]);
    expect(walls[1].distance).toBeCloseTo(0.03);
    expect(findWalls(book, { minUsd: 5_000_000 })).toEqual([]);
  });

  it('prefers the live mid for aggregated books', () => {
    const agg = parseBook(raw, 3)!;
    expect(referenceMid(agg, 100.05)).toBe(100.05);
    expect(referenceMid(agg, 150)).toBeCloseTo(100); // outside the best bid/ask: ignored
    expect(referenceMid(book, 100.05)).toBeCloseTo(100); // full precision: own mid
    expect(analyzeBook(book, { wallUsd: 1_000_000 }).walls).toHaveLength(2);
  });
});
