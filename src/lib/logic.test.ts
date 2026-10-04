import { describe, expect, it, vi } from 'vitest';
import { TradeAggregator } from './aggregator';
import { diffSnapshots } from './alerts';
import { fmtPct, fmtPx, fmtSize, fmtUsd, isAddress, shortAddr } from './format';
import { parseLeaderboard, toCompact } from './leaderboard';
import { aggregateByCoin, liqDistance, parseClearinghouse, toLive } from './positions';
import { WeightLimiter } from './rateLimiter';
import { computeFillStats } from './stats';
import type { HLClearinghouseState, HLFill, HLWsTrade, WalletSnapshot } from './types';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);

function chs(positions: { coin: string; szi: string; entryPx: string; positionValue: string; liq?: string | null; lev?: number }[]): HLClearinghouseState {
  return {
    assetPositions: positions.map((p) => ({
      type: 'oneWay',
      position: {
        coin: p.coin,
        szi: p.szi,
        entryPx: p.entryPx,
        positionValue: p.positionValue,
        unrealizedPnl: '0',
        returnOnEquity: '0',
        liquidationPx: p.liq === undefined ? null : p.liq,
        leverage: { type: 'cross', value: p.lev ?? 10 },
        marginUsed: '1000',
        cumFunding: { allTime: '5', sinceOpen: '2', sinceChange: '1' },
      },
    })),
    marginSummary: { accountValue: '2000000', totalNtlPos: '10000000', totalRawUsd: '0', totalMarginUsed: '500000' },
    crossMarginSummary: { accountValue: '2000000', totalNtlPos: '10000000', totalRawUsd: '0', totalMarginUsed: '500000' },
    crossMaintenanceMarginUsed: '0',
    withdrawable: '1500000',
    time: 1_700_000_000_000,
  };
}

describe('format', () => {
  it('formats compact USD', () => {
    expect(fmtUsd(5_250_000)).toBe('$5.25M');
    expect(fmtUsd(-1_200_000_000)).toBe('-$1.20B');
    expect(fmtUsd(12_500, { sign: true })).toBe('+$12.5K');
    expect(fmtUsd(950)).toBe('$950.00');
  });
  it('formats prices by magnitude', () => {
    expect(fmtPx(61234.56)).toBe('61,234.6');
    expect(fmtPx(0.000012345)).toBe('0.00001235');
    expect(fmtPx(null)).toBe('–');
    expect(fmtSize(7_218_750_000)).toBe('7.22B');
    expect(fmtSize(1_250_000)).toBe('1.25M');
  });
  it('formats percentages and addresses', () => {
    expect(fmtPct(0.0512, { sign: true })).toBe('+5.12%');
    expect(shortAddr(A)).toBe('0xaaaa…aaaa');
    expect(isAddress(A)).toBe(true);
    expect(isAddress('0x123')).toBe(false);
  });
});

describe('positions', () => {
  it('parses clearinghouse state, sorted by value, funding sign flipped', () => {
    const w = parseClearinghouse(
      A.toUpperCase().replace('0X', '0x'),
      chs([
        { coin: 'ETH', szi: '-1000', entryPx: '3000', positionValue: '2900000', liq: '3300' },
        { coin: 'BTC', szi: '100', entryPx: '60000', positionValue: '6100000', liq: '50000' },
      ]),
    );
    expect(w.address).toBe(A);
    expect(w.positions.map((p) => p.coin)).toEqual(['BTC', 'ETH']);
    expect(w.positions[1].side).toBe('short');
    expect(w.positions[1].size).toBe(1000);
    expect(w.positions[0].fundingSinceOpen).toBe(-2);
    expect(w.accountValue).toBe(2_000_000);
  });

  it('computes distance to liquidation for both sides', () => {
    expect(liqDistance('long', 100, 90)).toBeCloseTo(0.1);
    expect(liqDistance('short', 100, 104)).toBeCloseTo(0.04);
    expect(liqDistance('long', 100, null)).toBeNull();
  });

  it('re-prices with live mids and aggregates per coin', () => {
    const w1 = parseClearinghouse(A, chs([{ coin: 'BTC', szi: '100', entryPx: '60000', positionValue: '6000000', lev: 20 }]));
    const w2 = parseClearinghouse(B, chs([{ coin: 'BTC', szi: '-50', entryPx: '62000', positionValue: '3000000' }]));
    const w3 = parseClearinghouse(C, chs([{ coin: 'BTC', szi: '300', entryPx: '58000', positionValue: '18000000' }]));
    const mids = new Map([['BTC', 61000]]);
    const live = [w1, w2, w3].map((w) => toLive(w.positions[0], w, mids));
    expect(live[0].notional).toBe(6_100_000);
    expect(live[0].livePnl).toBe(100_000);
    expect(live[0].liveRoe).toBeCloseTo(100_000 / (6_000_000 / 20));
    expect(live[1].livePnl).toBe(50_000); // short profits when price falls from 62k to 61k
    const [agg] = aggregateByCoin(live);
    expect(agg.longCount).toBe(2);
    expect(agg.shortCount).toBe(1);
    expect(agg.longUsd).toBe(400 * 61000);
    expect(agg.longAvgEntry).toBeCloseTo((100 * 60000 + 300 * 58000) / 400);
    expect(agg.shortAvgEntry).toBe(62000);
  });
});

describe('TradeAggregator', () => {
  const t = (over: Partial<HLWsTrade>): HLWsTrade => ({
    coin: 'BTC',
    side: 'B',
    px: '60000',
    sz: '10',
    hash: '0xabc',
    time: 1000,
    tid: 1,
    users: [A, B],
    ...over,
  });

  it('merges fills of one taker order and finds the top maker', () => {
    const agg = new TradeAggregator();
    agg.add(t({ users: [A, B] }), 0);
    agg.add(t({ users: [A, C], px: '60010', sz: '30' }), 100);
    agg.add(t({ hash: '0xdef', side: 'A', users: [C, B] }), 100);
    expect(agg.flush(1000)).toEqual([]);
    const out = agg.flush(2000).sort((x, y) => y.notional - x.notional);
    expect(out).toHaveLength(2);
    expect(out[0].taker).toBe(A);
    expect(out[0].side).toBe('buy');
    expect(out[0].fills).toBe(2);
    expect(out[0].notional).toBe(10 * 60000 + 30 * 60010);
    expect(out[0].avgPx).toBeCloseTo(out[0].notional / 40);
    expect(out[0].topMaker?.address).toBe(C);
    expect(out[1].side).toBe('sell');
    expect(out[1].taker).toBe(B); // seller is the taker on an "A" trade
    expect(agg.pending).toBe(0);
  });

  it('does not merge hash-less fills of different takers', () => {
    const agg = new TradeAggregator();
    const zero = '0x' + '0'.repeat(64);
    agg.add(t({ hash: zero, users: [A, B] }), 0);
    agg.add(t({ hash: zero, users: [C, B] }), 0);
    expect(agg.flush(5000)).toHaveLength(2);
  });
});

describe('diffSnapshots', () => {
  const snap = (positions: Parameters<typeof chs>[0]): WalletSnapshot => parseClearinghouse(A, chs(positions));
  const opts = { sizeChangePct: 10, liqPct: 5 };

  it('detects open, close, increase and flip', () => {
    const prev = snap([
      { coin: 'BTC', szi: '100', entryPx: '60000', positionValue: '6000000' },
      { coin: 'ETH', szi: '1000', entryPx: '3000', positionValue: '3000000' },
      { coin: 'SOL', szi: '1000', entryPx: '150', positionValue: '150000' },
    ]);
    const curr = snap([
      { coin: 'BTC', szi: '150', entryPx: '60000', positionValue: '9000000' },
      { coin: 'ETH', szi: '-500', entryPx: '3000', positionValue: '1500000' },
      { coin: 'HYPE', szi: '-100000', entryPx: '40', positionValue: '4000000' },
    ]);
    const kinds = diffSnapshots(prev, curr, opts, new Map()).map((e) => `${e.kind}:${e.coin}`);
    expect(kinds.sort()).toEqual(['close:SOL', 'flip:ETH', 'increase:BTC', 'open:HYPE']);
  });

  it('ignores small size changes', () => {
    const prev = snap([{ coin: 'BTC', szi: '100', entryPx: '60000', positionValue: '6000000' }]);
    const curr = snap([{ coin: 'BTC', szi: '105', entryPx: '60000', positionValue: '6300000' }]);
    expect(diffSnapshots(prev, curr, opts, new Map())).toEqual([]);
  });

  it('alerts near liquidation once until the position moves away again', () => {
    const armed = new Map<string, boolean>();
    const near = snap([{ coin: 'BTC', szi: '100', entryPx: '60000', positionValue: '6000000', liq: '58000' }]); // 3.3% away
    const far = snap([{ coin: 'BTC', szi: '100', entryPx: '60000', positionValue: '6000000', liq: '50000' }]); // 16.7% away
    expect(diffSnapshots(far, near, opts, armed).map((e) => e.kind)).toEqual(['liq']);
    expect(diffSnapshots(near, near, opts, armed)).toEqual([]);
    diffSnapshots(near, far, opts, armed);
    expect(diffSnapshots(far, near, opts, armed).map((e) => e.kind)).toEqual(['liq']);
  });
});

describe('leaderboard', () => {
  it('parses the raw Hyperliquid format and round-trips the compact format', () => {
    const raw = {
      leaderboardRows: [
        {
          ethAddress: A.toUpperCase().replace('0X', '0x'),
          accountValue: '1234567.8',
          displayName: 'Paus',
          prize: 0,
          windowPerformances: [
            ['day', { pnl: '10', roi: '0', vlm: '1' }],
            ['week', { pnl: '20', roi: '0', vlm: '2' }],
            ['month', { pnl: '30', roi: '0', vlm: '3000' }],
            ['allTime', { pnl: '40', roi: '0', vlm: '4' }],
          ],
        },
      ],
    };
    const [acc] = parseLeaderboard(raw);
    expect(acc).toMatchObject({ address: A, accountValue: 1234567.8, displayName: 'Paus', pnlMonth: 30, pnlAllTime: 40, vlmMonth: 3000 });
    const [back] = parseLeaderboard({ generatedAt: 1, rows: [toCompact(acc)] });
    expect(back).toMatchObject({ address: A, accountValue: 1234568, displayName: 'Paus', pnlWeek: 20 });
    expect(parseLeaderboard(null)).toEqual([]);
  });
});

describe('WeightLimiter', () => {
  it('serves higher priority first and throttles by weight', async () => {
    vi.useFakeTimers();
    try {
      const lim = new WeightLimiter(600, { capacity: 10 }); // refills 10 weight per second
      const order: string[] = [];
      await lim.acquire(10, 0); // drain the bucket
      const low = lim.acquire(5, 0).then(() => order.push('low'));
      const high = lim.acquire(5, 2).then(() => order.push('high'));
      await vi.advanceTimersByTimeAsync(300);
      expect(order).toEqual([]);
      await vi.advanceTimersByTimeAsync(250); // 5.5 tokens: exactly one request
      expect(order).toEqual(['high']);
      await vi.advanceTimersByTimeAsync(500);
      await Promise.all([low, high]);
      expect(order).toEqual(['high', 'low']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('WeightLimiter reserve', () => {
  it('keeps a reserve that only higher-priority requests may use', async () => {
    vi.useFakeTimers();
    try {
      const lim = new WeightLimiter(60, { capacity: 100, reserve: 80 }); // 1 weight per second
      const served: string[] = [];
      void lim.acquire(20, 0).then(() => served.push('scan1')); // 100 - 20 = 80 left
      void lim.acquire(20, 0).then(() => served.push('scan2')); // would dip into the reserve: waits
      await vi.advanceTimersByTimeAsync(10);
      expect(served).toEqual(['scan1']);
      void lim.acquire(60, 2).then(() => served.push('user')); // served from the reserve right away
      await vi.advanceTimersByTimeAsync(10);
      expect(served).toEqual(['scan1', 'user']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('computeFillStats', () => {
  it('summarises fills', () => {
    const f = (coin: string, px: string, sz: string, closedPnl: string, fee: string, time: number, dir = 'Close Long'): HLFill => ({
      coin, px, sz, closedPnl, fee, time, dir, side: 'A', startPosition: '0', hash: '0x', oid: 1, crossed: true, tid: time,
    });
    const s = computeFillStats([
      f('BTC', '60000', '1', '0', '10', 1, 'Open Long'),
      f('BTC', '61000', '1', '1000', '10', 2),
      f('ETH', '3000', '10', '-200', '5', 3),
    ]);
    expect(s.volume).toBe(60000 + 61000 + 30000);
    expect(s.realizedPnl).toBe(800);
    expect(s.netPnl).toBe(775);
    expect(s.winRate).toBe(0.5);
    expect(s.biggestLoss).toBe(-200);
    expect(s.byCoin[0].coin).toBe('BTC');
    expect(s.firstTime).toBe(1);
  });
});
