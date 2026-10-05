import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  absSpread,
  arbHint,
  defaultIntervalHours,
  fetchPredictedFundings,
  normalizeVenue,
  parsePredictedFundings,
  toApr,
  type RawPredictedFundings,
} from './fundingCompare';

const T = 1_733_961_600_000;

const RAW: RawPredictedFundings = [
  [
    'BTC',
    [
      ['BinPerp', { fundingRate: '0.0001', nextFundingTime: T }],
      ['HlPerp', { fundingRate: '0.0000125', nextFundingTime: T, fundingIntervalHours: 1 }],
      ['BybitPerp', { fundingRate: '0.0002', nextFundingTime: T, fundingIntervalHours: 8 }],
    ],
  ],
  [
    'HYPE',
    [
      ['HlPerp', { fundingRate: '0.0001', nextFundingTime: T }],
      ['BinPerp', { fundingRate: '0.0001', nextFundingTime: T, fundingIntervalHours: 4 }],
      null,
    ],
  ],
  ['kPEPE', [['HlPerp', { fundingRate: '-0.00005', nextFundingTime: T }], ['BybitPerp', null]]],
  ['ONLYCEX', [['BinPerp', { fundingRate: '0.0003', nextFundingTime: T }]]],
];

describe('normalizeVenue', () => {
  it('defaults to 1h for Hyperliquid and 8h for the CEXs', () => {
    expect(defaultIntervalHours('HlPerp')).toBe(1);
    expect(defaultIntervalHours('BinPerp')).toBe(8);
    expect(defaultIntervalHours('BybitPerp')).toBe(8);
    expect(defaultIntervalHours('OkxPerp')).toBe(8);
  });

  it('divides the interval rate by fundingIntervalHours when given', () => {
    const v = normalizeVenue('BinPerp', { fundingRate: '0.0004', nextFundingTime: T, fundingIntervalHours: 4 })!;
    expect(v.intervalHours).toBe(4);
    expect(v.hourly).toBeCloseTo(0.0001, 12);
    expect(v.apr).toBeCloseTo(0.0001 * 8760, 9);
    expect(v.nextFundingTime).toBe(T);
  });

  it('falls back to the default interval for missing or invalid fundingIntervalHours', () => {
    expect(normalizeVenue('BinPerp', { fundingRate: '0.0008', nextFundingTime: T })!.hourly).toBeCloseTo(0.0001, 12);
    expect(normalizeVenue('BinPerp', { fundingRate: '0.0008', nextFundingTime: T, fundingIntervalHours: 0 })!.intervalHours).toBe(8);
    expect(normalizeVenue('HlPerp', { fundingRate: 0.00002, nextFundingTime: T, fundingIntervalHours: null })!.hourly).toBe(0.00002);
  });

  it('rejects missing or unreadable rates', () => {
    expect(normalizeVenue('BinPerp', null)).toBeNull();
    expect(normalizeVenue('BinPerp', { fundingRate: 'abc', nextFundingTime: T })).toBeNull();
  });
});

describe('parsePredictedFundings', () => {
  const rows = parsePredictedFundings(RAW);
  const by = (c: string) => rows.find((r) => r.coin === c)!;

  it('keeps every coin and maps venues whatever their order', () => {
    expect(rows.map((r) => r.coin)).toEqual(['BTC', 'HYPE', 'kPEPE', 'ONLYCEX']);
    expect(by('BTC').hl!.hourly).toBe(0.0000125);
    expect(by('BTC').bin!.hourly).toBeCloseTo(0.0000125, 12);
    expect(by('BTC').bybit!.hourly).toBeCloseTo(0.000025, 12);
  });

  it('computes HL-minus-venue APR spreads and picks the widest', () => {
    const btc = by('BTC');
    expect(btc.spread.bin).toBeCloseTo(0, 12);
    expect(btc.spread.bybit).toBeCloseTo(toApr(0.0000125 - 0.000025), 9);
    expect(btc.best!.venue).toBe('bybit');

    const hype = by('HYPE');
    expect(hype.bin!.intervalHours).toBe(4);
    expect(hype.spread.bin).toBeCloseTo(toApr(0.0001 - 0.000025), 9);
    expect(hype.bybit).toBeNull();
    expect(hype.spread.bybit).toBeNull();
    expect(hype.best!.venue).toBe('bin');
  });

  it('handles null entries and venues with null data', () => {
    const k = by('kPEPE');
    expect(k.hl!.hourly).toBe(-0.00005);
    expect(k.bybit).toBeNull();
    expect(k.best).toBeNull();
    expect(Number.isNaN(absSpread(k))).toBe(true);
  });

  it('has no spread when Hyperliquid is missing', () => {
    expect(by('ONLYCEX').hl).toBeNull();
    expect(by('ONLYCEX').best).toBeNull();
  });

  it('tolerates malformed input', () => {
    expect(parsePredictedFundings(null)).toEqual([]);
    expect(parsePredictedFundings({ x: 1 })).toEqual([]);
    expect(parsePredictedFundings([42, ['X'], ['Y', null], ['Z', [['HlPerp']]]]).map((r) => r.coin)).toEqual(['X', 'Y', 'Z']);
  });
});

describe('arbHint', () => {
  const rows = parsePredictedFundings(RAW);

  it('shorts the venue paying the higher funding and longs the other', () => {
    // HYPE: HL 87.6% APR vs Binance 21.9% → short HL, long Binance
    const h = arbHint(rows[1])!;
    expect(h).toMatchObject({ long: 'bin', short: 'hl' });
    expect(h.spreadApr).toBeCloseTo(toApr(0.000075), 9);
  });

  it('longs HL when HL funding is the lower one', () => {
    // BTC: HL 10.95% vs Bybit 21.9% → long HL, short Bybit
    expect(arbHint(rows[0])).toMatchObject({ long: 'hl', short: 'bybit' });
  });

  it('stays quiet below the threshold or without a comparison', () => {
    expect(arbHint(rows[0], 0.5)).toBeNull();
    expect(arbHint(rows[2])).toBeNull();
  });
});

describe('fetchPredictedFundings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts predictedFundings and returns normalised rows', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(RAW), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const rows = await fetchPredictedFundings();
    expect(rows).toHaveLength(4);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.hyperliquid.xyz/info');
    expect(JSON.parse(String(init.body))).toEqual({ type: 'predictedFundings' });
  });
});
