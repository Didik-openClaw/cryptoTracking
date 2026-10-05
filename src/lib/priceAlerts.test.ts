import { describe, expect, it } from 'vitest';
import { addSample, crossed, windowMove, type Sample } from './priceAlerts';

describe('price alerts', () => {
  it('fires only when the price crosses the level in the alert direction', () => {
    expect(crossed('above', 100, 99, 100)).toBe(true);
    expect(crossed('above', 100, 99, 101)).toBe(true);
    expect(crossed('above', 100, 101, 102)).toBe(false); // already above: no cross
    expect(crossed('above', 100, undefined, 101)).toBe(false); // first observation
    expect(crossed('below', 100, 101, 100)).toBe(true);
    expect(crossed('below', 100, 99, 98)).toBe(false);
    expect(crossed('below', 100, 101, 102)).toBe(false);
  });

  it('measures the move from the oldest sample inside the window', () => {
    const h: Sample[] = [
      { t: 0, px: 100 },
      { t: 5 * 60_000, px: 101 },
      { t: 10 * 60_000, px: 102 },
    ];
    // 15-minute window at t = 15 min: oldest sample in the window is t = 0 (100) → +3 %
    expect(windowMove(h, 15 * 60_000, 15 * 60_000, 103)).toBeCloseTo(0.03);
    // 10-minute window at t = 15 min: oldest in window is t = 5 min (101)
    expect(windowMove(h, 15 * 60_000, 10 * 60_000, 99.99)).toBeCloseTo(-0.01);
    // Less than half a window of history: no verdict yet
    expect(windowMove([{ t: 0, px: 100 }], 60_000, 15 * 60_000, 120)).toBeNull();
  });

  it('samples at most every 10 s and keeps 4 hours', () => {
    let h: Sample[] = [];
    h = addSample(h, 0, 1);
    h = addSample(h, 5_000, 2); // too soon
    h = addSample(h, 10_000, 3);
    expect(h.map((s) => s.px)).toEqual([1, 3]);
    h = addSample(h, 4 * 3_600_000 + 5_000, 4);
    expect(h.map((s) => s.px)).toEqual([3, 4]);
  });
});
