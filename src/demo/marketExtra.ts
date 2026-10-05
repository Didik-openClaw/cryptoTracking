import type { DemoCoin, DemoMarket } from './extra';

/**
 * Demo for market-wide requests: `predictedFundings` (Hyperliquid vs Binance
 * vs Bybit) and `fundingHistory` (hourly rows). Values are invented but shaped
 * like the real API: rates as decimal strings, CEX rates per 8h (some 4h)
 * interval, at most 500 history rows per request. Returns undefined for
 * other request types.
 */

const H = 3_600_000;
/** Hyperliquid's resting hourly rate: 0.01% per 8h interest component. */
const BASE = 0.0000125;

// Venue coverage in the simulation: Bybit lacks some coins, Binance one.
const NO_BYBIT = new Set(['kPEPE', 'FARTCOIN', 'TAO']);
const NO_BINANCE = new Set(['FARTCOIN']);
const BINANCE_4H = new Set(['WIF', 'ENA']);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Decimal string without exponent notation, as the API sends it ("0.0000125", "-0.00011"). */
function dec(x: number): string {
  const s = x.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

const nextBoundary = (now: number, hours: number) => Math.ceil((now + 1) / (hours * H)) * hours * H;

function predicted(market: DemoMarket) {
  const now = Date.now();
  const bucket = Math.floor(now / 60_000); // values drift a little from one refresh to the next
  return market.coins.map((c) => {
    const seed = hash(c.name);
    const r = rng(seed ^ bucket);
    const cur = market.funding.get(c.name) ?? BASE;
    const scale = Math.max(Math.abs(cur), BASE);
    const hl = cur + (r() - 0.5) * scale * 0.2;
    // CEX funding is usually tamer than Hyperliquid's; for some coins it runs hotter.
    const k = seed % 5 === 0 ? 1.4 + r() * 0.6 : 0.25 + (seed % 7) / 10;
    const bin = BASE + (hl - BASE) * k + (r() - 0.5) * BASE * 0.6;
    const bybit = bin * (0.85 + r() * 0.3) + (r() - 0.5) * BASE * 0.4;
    const binHours = BINANCE_4H.has(c.name) ? 4 : 8;
    const venues: ([string, Record<string, unknown>] | null)[] = [
      NO_BINANCE.has(c.name)
        ? null
        : [
            'BinPerp',
            {
              fundingRate: dec(bin * binHours),
              nextFundingTime: nextBoundary(now, binHours),
              // The 8h default is left implicit to exercise the client's fallback.
              ...(binHours !== 8 && { fundingIntervalHours: binHours }),
            },
          ],
      ['HlPerp', { fundingRate: dec(hl), nextFundingTime: nextBoundary(now, 1), fundingIntervalHours: 1 }],
      NO_BYBIT.has(c.name) ? null : ['BybitPerp', { fundingRate: dec(bybit * 8), nextFundingTime: nextBoundary(now, 8), fundingIntervalHours: 8 }],
    ];
    return [c.name, venues];
  });
}

/** Hourly rate at hour `t`: a slow regime swing plus noise, converging on the current rate near the present. */
function histRate(c: DemoCoin, cur: number, t: number, nowHour: number): number {
  const h = t / H;
  const seed = hash(c.name);
  const r = rng(seed ^ h);
  const phase = (seed % 1000) / 100;
  const scale = Math.max(Math.abs(cur), BASE);
  const drift = BASE + (cur - BASE) * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(h / 97 + phase)));
  const swing = scale * 0.45 * Math.sin(h / 11 + phase * 2) + scale * 0.5 * (r() - 0.5);
  const w = Math.exp(-Math.max(0, nowHour - t) / H / 36);
  let rate = w * cur + (1 - w) * (drift + swing);
  // Hyperliquid funding often rests exactly on the interest-rate floor.
  if (Math.abs(rate - BASE) < scale * 0.12) rate = BASE;
  return rate;
}

function history(body: Record<string, unknown>, market: DemoMarket) {
  const c = market.coins.find((x) => x.name === body.coin);
  if (!c) return [];
  const now = Date.now();
  const nowHour = Math.floor(now / H) * H;
  const start = Number(body.startTime) || now - 7 * 86_400_000;
  const end = Math.min(Number(body.endTime) || now, now);
  const cur = market.funding.get(c.name) ?? BASE;
  const out = [];
  for (let t = Math.ceil(start / H) * H; t <= end && out.length < 500; t += H) {
    const rate = histRate(c, cur, t, nowHour);
    // Invert Hyperliquid's formula: 8h funding = premium + clamp(0.01% − premium, ±0.05%).
    const f8 = rate * 8;
    const premium = f8 > 0.0001 + 1e-12 ? f8 + 0.0005 : f8 < 0.0001 - 1e-12 ? f8 - 0.0005 : 0.0001 + (rng(hash(c.name) ^ (t / H) ^ 7)() - 0.5) * 0.0008;
    out.push({ coin: c.name, fundingRate: dec(rate), premium: dec(premium), time: t });
  }
  return out;
}

export function marketInfo(body: Record<string, unknown>, market: DemoMarket): unknown {
  switch (body.type) {
    case 'predictedFundings':
      return predicted(market);
    case 'fundingHistory':
      return history(body, market);
    default:
      return undefined;
  }
}
