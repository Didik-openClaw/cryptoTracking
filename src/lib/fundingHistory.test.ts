import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchFundingHistory, loadFundingWindow, parseFundingHistory, summarizeFunding, type FundingPoint } from './fundingHistory';

const H = 3_600_000;
const T0 = 1_759_000_000_000 - (1_759_000_000_000 % H);

const row = (i: number, rate = 0.00001) => ({ coin: 'BTC', fundingRate: String(rate), premium: '0.0001', time: T0 + i * H });

describe('parseFundingHistory', () => {
  it('parses, sorts and de-duplicates rows', () => {
    const pts = parseFundingHistory([row(2, 0.00003), row(0), row(1, -0.00002), row(2, 0.00003), { time: 'x', fundingRate: '1' }]);
    expect(pts.map((p) => p.time)).toEqual([T0, T0 + H, T0 + 2 * H]);
    expect(pts[1]).toEqual({ time: T0 + H, rate: -0.00002, premium: 0.0001 });
  });

  it('returns [] for anything but an array', () => {
    expect(parseFundingHistory(null)).toEqual([]);
    expect(parseFundingHistory({})).toEqual([]);
  });
});

describe('fetchFundingHistory', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(total: number) {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { startTime: number };
        bodies.push(body);
        const first = Math.max(0, Math.ceil((body.startTime - T0) / H));
        const rows = [];
        for (let i = first; i < total && rows.length < 500; i++) rows.push(row(i));
        return new Response(JSON.stringify(rows), { status: 200 });
      }),
    );
    return bodies;
  }

  it('pages forward past the 500-row cap until a short page', async () => {
    const bodies = stub(720);
    const pts = await fetchFundingHistory('BTC', T0);
    expect(pts).toHaveLength(720);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual({ type: 'fundingHistory', coin: 'BTC', startTime: T0 });
    expect(bodies[1].startTime).toBe(T0 + 499 * H + 1);
  });

  it('stops after one request when the first page is short', async () => {
    const bodies = stub(24);
    expect(await fetchFundingHistory('BTC', T0)).toHaveLength(24);
    expect(bodies).toHaveLength(1);
  });

  it('respects maxPages', async () => {
    const bodies = stub(5000);
    expect(await fetchFundingHistory('BTC', T0, { maxPages: 2 })).toHaveLength(1000);
    expect(bodies).toHaveLength(2);
  });

  it('serves a narrower window from a fresh wider one', async () => {
    const now = T0 + 720 * H;
    const bodies = stub(720);
    const month = await loadFundingWindow('ETH', '30d', undefined, now);
    expect(month).toHaveLength(720);
    const day = await loadFundingWindow('ETH', '24h', undefined, now + 60_000);
    expect(bodies).toHaveLength(2); // no extra request
    expect(day.every((p) => p.time >= now + 60_000 - 86_400_000)).toBe(true);
    expect(day.length).toBe(23);
  });
});

describe('summarizeFunding', () => {
  it('is null without data', () => {
    expect(summarizeFunding([])).toBeNull();
  });

  it('computes current, average, extremes, cumulative and APR', () => {
    const pts: FundingPoint[] = [0.00001, -0.00002, 0.00004, 0.00003].map((rate, i) => ({ time: T0 + i * H, rate, premium: 0 }));
    const s = summarizeFunding(pts)!;
    expect(s.count).toBe(4);
    expect(s.current).toBe(0.00003);
    expect(s.avg).toBeCloseTo(0.000015, 12);
    expect(s.min).toBe(-0.00002);
    expect(s.max).toBe(0.00004);
    expect(s.cumulative).toBeCloseTo(0.00006, 12);
    expect(s.positiveShare).toBe(0.75);
    expect(s.apr.avg).toBeCloseTo(0.000015 * 8760, 9);
    expect(s.apr.min).toBeCloseTo(-0.00002 * 8760, 9);
  });
});
