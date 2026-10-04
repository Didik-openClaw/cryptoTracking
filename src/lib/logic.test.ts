import { describe, expect, it, vi } from 'vitest';
import { TradeAggregator } from './aggregator';
import { diffSnapshots } from './alerts';
import { fmtAge, fmtPct, fmtPx, fmtSize, fmtUsd, isAddress, shortAddr } from './format';
import { parseLeaderboard, toCompact } from './leaderboard';
import { findOpenTime } from './openTimes';
import { matchesCoin, parseNews, type NewsItem } from './news';
import { changeOver, crossing } from './wire';
import { aggregateByCoin, liqDistance, parseClearinghouse, toLive } from './positions';
import { WeightLimiter } from './rateLimiter';
import { computeFillStats, computeTraderStats, roundTrips } from './stats';
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
    expect(fmtUsd(5908.74)).toBe('$5.91K');
    expect(fmtUsd(5908.74, { compact: false })).toBe('$5,908.74');
  });
  it('formats prices by magnitude', () => {
    expect(fmtPx(61234.56)).toBe('61,234.6');
    expect(fmtPx(0.000012345)).toBe('0.00001235');
    expect(fmtPx(null)).toBe('–');
    expect(fmtSize(7_218_750_000)).toBe('7.22B');
    expect(fmtSize(1_250_000)).toBe('1.25M');
    expect(fmtAge(0, 45 * 60_000)).toBe('45m');
    expect(fmtAge(0, (3 * 60 + 20) * 60_000)).toBe('3j 20m');
    expect(fmtAge(0, (2 * 24 + 5) * 3_600_000)).toBe('2hr 5j');
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

describe('findOpenTime', () => {
  const fill = (time: number, side: 'A' | 'B', sz: number, startPosition: number, coin = 'BTC'): HLFill => ({
    coin, px: '60000', sz: String(sz), side, time, startPosition: String(startPosition), dir: '', closedPnl: '0',
    hash: '0x', oid: time, crossed: true, fee: '0', tid: time,
  });

  it('finds the fill that opened the current position, ignoring later adds', () => {
    const fills = [
      fill(500, 'B', 5, 10), // add 10 -> 15
      fill(400, 'B', 10, 0), // open long 0 -> 10   <- current position opened here
      fill(300, 'A', 4, 4), // close previous long 4 -> 0
      fill(200, 'B', 4, 0), // older long
      fill(100, 'A', 1, 0, 'ETH'),
    ];
    expect(findOpenTime(fills, 'BTC', 15)).toEqual({ openedAt: 400, before: null, lastFillAt: 500 });
  });

  it('treats a flip as an open of the new side', () => {
    const fills = [fill(300, 'A', 2, -8), fill(200, 'A', 10, 2), fill(100, 'B', 2, 0)]; // long 2 -> short 8 -> 10
    expect(findOpenTime(fills, 'BTC', -10).openedAt).toBe(200);
    expect(findOpenTime(fills, 'BTC', 10).openedAt).toBe(100); // would be the long's open if it were still long
  });

  it('reports an older-than bound when the API window is exhausted', () => {
    const fills = Array.from({ length: 2000 }, (_, i) => fill(10_000 - i, 'B', 1, 50 + i));
    expect(findOpenTime(fills, 'BTC', 2050)).toEqual({ openedAt: null, before: 10_000 - 1999, lastFillAt: 10_000 });
    expect(findOpenTime([fill(5, 'B', 1, 3)], 'BTC', 4).openedAt).toBeNull();
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
            ['day', { pnl: '10', roi: '0.01', vlm: '1' }],
            ['week', { pnl: '20', roi: '0.02', vlm: '2' }],
            ['month', { pnl: '30', roi: '0.03', vlm: '3000' }],
            ['allTime', { pnl: '40', roi: '0.04', vlm: '4' }],
          ],
        },
      ],
    };
    const [acc] = parseLeaderboard(raw);
    expect(acc).toMatchObject({ address: A, accountValue: 1234567.8, displayName: 'Paus' });
    expect(acc.pnl).toEqual({ day: 10, week: 20, month: 30, allTime: 40 });
    expect(acc.vlm.month).toBe(3000);
    const [back] = parseLeaderboard({ generatedAt: 1, rows: [toCompact(acc)] });
    expect(back).toMatchObject({ address: A, accountValue: 1234568, displayName: 'Paus' });
    expect(back.pnl.week).toBe(20);
    expect(back.vlm).toEqual(acc.vlm);
    // Rows written by older builds stop after vlmMonth.
    const [old] = parseLeaderboard({ generatedAt: 1, rows: [[A, 5, null, 1, 2, 3, 4, 9]] });
    expect(old.pnl.allTime).toBe(4);
    expect(old.roi.month).toBe(0);
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

describe('WeightLimiter charge', () => {
  it('makes later requests wait for weight charged after a response', async () => {
    vi.useFakeTimers();
    try {
      const lim = new WeightLimiter(60, { capacity: 30 }); // 1 weight per second
      const served: string[] = [];
      await lim.acquire(20, 2);
      lim.charge(15); // 30 - 20 - 15 = -5
      void lim.acquire(5, 2).then(() => served.push('next'));
      await vi.advanceTimersByTimeAsync(9_000);
      expect(served).toEqual([]);
      await vi.advanceTimersByTimeAsync(1_100);
      expect(served).toEqual(['next']);
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

describe('round trips & trader stats', () => {
  const f = (time: number, side: 'A' | 'B', sz: number, start: number, closedPnl = 0, coin = 'BTC', px = 100): HLFill => ({
    coin, px: String(px), sz: String(sz), side, time, startPosition: String(start), dir: '', closedPnl: String(closedPnl),
    hash: '0x', oid: time, crossed: true, fee: '1', tid: time,
  });

  it('rebuilds trips, skipping a position that predates the window', () => {
    const fills = [
      f(1, 'A', 5, 5, 40), // closes a long opened before the window: ignored
      f(2, 'B', 10, 0), // open long 10
      f(3, 'B', 5, 10), // add
      f(4, 'A', 8, 15, 30), // partial close
      f(5, 'A', 7, 7, 20), // close -> trip 1 pnl 50
      f(6, 'A', 4, 0), // open short 4
      f(7, 'B', 10, -4, -25), // flip: closes short (trip 2 pnl -25), opens long 6
      f(8, 'A', 6, 6, 10), // close long -> trip 3 pnl 10
      f(9, 'B', 3, 0, 0, 'ETH'), // still open: not a trip
    ];
    const trips = roundTrips(fills);
    expect(trips.map((t) => [t.side, t.openAt, t.closeAt, t.pnl])).toEqual([
      ['long', 2, 5, 50],
      ['short', 6, 7, -25],
      ['long', 7, 8, 10],
    ]);
    const s = computeTraderStats(fills);
    expect(s.trades).toBe(3);
    expect(s.winRate).toBeCloseTo(2 / 3);
    expect(s.profitFactor).toBeCloseTo(60 / 25);
    expect(s.avgWin).toBe(30);
    expect(s.avgLoss).toBe(25);
    expect(s.payoff).toBeCloseTo(30 / 25);
    expect(s.expectancy).toBeCloseTo(35 / 3);
    expect(s.maxWinStreak).toBe(1);
    expect(s.realizedPnl).toBe(40 + 30 + 20 - 25 + 10);
    expect(s.fees).toBe(9);
    // opening notional: long 10+5 (BTC), short 4, long 6 (flip remainder), long 3 (ETH)
    expect(s.longShare).toBeCloseTo((10 + 5 + 6 + 3) / (10 + 5 + 4 + 6 + 3));
    expect(s.avgHoldMs).toBeCloseTo((3 + 1 + 1) / 3);
  });

  it('handles no losses and no trades', () => {
    expect(computeTraderStats([f(1, 'B', 1, 0), f(2, 'A', 1, 1, 5)]).profitFactor).toBe(Infinity);
    const empty = computeTraderStats([]);
    expect(empty.winRate).toBeNull();
    expect(empty.profitFactor).toBeNull();
    expect(empty.trades).toBe(0);
  });
});

describe('news', () => {
  it('parses CoinDesk Data and CryptoCompare formats', () => {
    const coindesk = {
      Data: [
        {
          ID: 1,
          TITLE: 'Hyperliquid whale opens $40M BTC long',
          URL: 'https://example.com/1',
          PUBLISHED_ON: 1_790_000_000,
          BODY: '<p>Body</p>',
          SENTIMENT: 'POSITIVE',
          SOURCE_DATA: { NAME: 'CoinDesk' },
          CATEGORY_DATA: [{ CATEGORY: 'BTC' }, { CATEGORY: 'TRADING' }],
        },
      ],
    };
    const cc = {
      Data: [
        { id: '7', title: 'Solana ETF filing', url: 'https://example.com/7', published_on: 1_790_000_100, body: 'x', categories: 'SOL|Regulation', source_info: { name: 'The Block' } },
        { id: '8', title: 'bad url', url: 'javascript:alert(1)', published_on: 1 },
      ],
    };
    const [a] = parseNews(coindesk);
    expect(a).toMatchObject({ id: '1', source: 'CoinDesk', publishedAt: 1_790_000_000_000, body: 'Body', tags: ['BTC', 'TRADING'], sentiment: 'pos' });
    const b = parseNews(cc);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ source: 'The Block', tags: ['SOL', 'REGULATION'], sentiment: null });
    expect(parseNews({ items: [a] })).toEqual([a]);
  });

  it('matches headlines to coins by tag, ticker or name', () => {
    const item = (title: string, tags: string[] = []): NewsItem => ({ id: title, title, url: 'https://x', source: 's', publishedAt: 0, body: '', tags, sentiment: null });
    expect(matchesCoin(item('Bitcoin slips below $60K'), 'BTC')).toBe(true);
    expect(matchesCoin(item('Market wrap', ['ETH']), 'ETH')).toBe(true);
    expect(matchesCoin(item('$SOL rallies'), 'SOL')).toBe(true);
    expect(matchesCoin(item('A solution for custody'), 'SOL')).toBe(false);
    expect(matchesCoin(item('Hyperliquid volume record'), 'HYPE')).toBe(true);
    expect(matchesCoin(item('PEPE memecoin surges'), 'kPEPE')).toBe(true);
  });
});

describe('wire helpers', () => {
  it('measures change over a window', () => {
    const hist: [number, number][] = [
      [0, 100],
      [60_000, 101],
      [120_000, 103],
    ];
    expect(changeOver(hist, 120_000, 60_000)).toBeCloseTo(103 / 101 - 1);
    expect(changeOver(hist, 120_000, 120_000)).toBeCloseTo(0.03);
    expect(changeOver(hist, 120_000, 200_000)).toBeNull();
  });

  it('fires a crossing once until re-armed', () => {
    const armed = new Map<string, boolean>();
    expect(crossing(armed, 'x', true, false)).toBe(true);
    expect(crossing(armed, 'x', true, false)).toBe(false);
    expect(crossing(armed, 'x', false, false)).toBe(false); // in the hysteresis band
    expect(crossing(armed, 'x', false, true)).toBe(false);
    expect(crossing(armed, 'x', true, false)).toBe(true);
  });
});
