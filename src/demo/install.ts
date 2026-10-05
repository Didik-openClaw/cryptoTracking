/**
 * Demo mode: a simulated Hyperliquid market that stands in for the real API
 * and websocket, for environments that cannot reach Hyperliquid (sandboxed
 * previews, offline development). Built only with `VITE_DEMO=1`.
 *
 * Every number here is invented. Addresses start with 0xdeadbeef so they can
 * never be mistaken for real accounts.
 */
import { extraInfo } from './extra';
import { INFO_URL, LEADERBOARD_URL, WS_URL } from '../lib/api';

// ---------- deterministic randomness ----------

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261004);
const pick = <T,>(xs: T[], r = rnd) => xs[Math.floor(r() * xs.length)];
const hex = (n: number, r = rnd) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const fakeAddr = (r = rnd) => `0xdeadbeef${hex(32, r)}`;

// ---------- market ----------

interface Coin {
  name: string;
  px: number;
  maxLev: number;
  szDec: number;
  vol: number; // 24h notional volume
  weight: number; // how often whales trade it
}

const COINS: Coin[] = [
  { name: 'BTC', px: 61840, maxLev: 40, szDec: 5, vol: 2.4e9, weight: 30 },
  { name: 'ETH', px: 3125, maxLev: 25, szDec: 4, vol: 1.3e9, weight: 20 },
  { name: 'SOL', px: 154.2, maxLev: 20, szDec: 2, vol: 5.2e8, weight: 10 },
  { name: 'HYPE', px: 39.8, maxLev: 10, szDec: 2, vol: 4.1e8, weight: 12 },
  { name: 'XRP', px: 0.618, maxLev: 20, szDec: 0, vol: 2.2e8, weight: 4 },
  { name: 'DOGE', px: 0.1213, maxLev: 10, szDec: 0, vol: 1.6e8, weight: 4 },
  { name: 'SUI', px: 1.93, maxLev: 10, szDec: 1, vol: 1.1e8, weight: 3 },
  { name: 'ENA', px: 0.452, maxLev: 10, szDec: 0, vol: 9e7, weight: 3 },
  { name: 'kPEPE', px: 0.01105, maxLev: 10, szDec: 0, vol: 8.5e7, weight: 3 },
  { name: 'AVAX', px: 27.4, maxLev: 10, szDec: 2, vol: 7e7, weight: 2 },
  { name: 'LINK', px: 13.05, maxLev: 10, szDec: 1, vol: 6e7, weight: 2 },
  { name: 'BNB', px: 579.5, maxLev: 10, szDec: 3, vol: 5.5e7, weight: 2 },
  { name: 'TAO', px: 381.2, maxLev: 5, szDec: 3, vol: 4e7, weight: 2 },
  { name: 'WIF', px: 2.08, maxLev: 10, szDec: 0, vol: 3.5e7, weight: 1 },
  { name: 'AAVE', px: 161.3, maxLev: 10, szDec: 2, vol: 3e7, weight: 1 },
  { name: 'FARTCOIN', px: 0.912, maxLev: 5, szDec: 1, vol: 2.8e7, weight: 1 },
];
const coinMap = new Map(COINS.map((c) => [c.name, c]));
const open0 = new Map(COINS.map((c) => [c.name, c.px * (1 + (rnd() - 0.5) * 0.08)])); // 24h-ago price
const funding = new Map(COINS.map((c) => [c.name, (rnd() - 0.35) * 0.00004]));
// Two crowded trades so the WIRE has funding extremes to report.
funding.set('HYPE', 0.000132);
funding.set('kPEPE', -0.000115);

function weightedCoin(): Coin {
  const total = COINS.reduce((t, c) => t + c.weight, 0);
  let x = rnd() * total;
  for (const c of COINS) if ((x -= c.weight) <= 0) return c;
  return COINS[0];
}

// Gentle random walk so marks, PnL and liquidation distances move.
setInterval(() => {
  for (const c of COINS) c.px *= 1 + (Math.random() - 0.5) * 0.0016;
}, 1000);

// ---------- accounts ----------

interface Pos {
  coin: string;
  szi: number;
  entry: number;
  lev: number;
  type: 'cross' | 'isolated';
  openedAt: number;
}
interface Fill {
  coin: string;
  px: number;
  sz: number;
  side: 'A' | 'B';
  start: number; // signed position before the fill
  time: number;
  dir: string;
  closedPnl: number;
}

function dirOf(start: number, delta: number): string {
  const after = start + delta;
  if (Math.abs(start) < 1e-12) return delta > 0 ? 'Open Long' : 'Open Short';
  if (Math.sign(start) === Math.sign(delta)) return start > 0 ? 'Open Long' : 'Open Short';
  if (Math.abs(after) > 1e-12 && Math.sign(after) !== Math.sign(start)) return start > 0 ? 'Long > Short' : 'Short > Long';
  return start > 0 ? 'Close Long' : 'Close Short';
}

function makeFill(coin: string, px: number, delta: number, start: number, time: number, closedPnl = 0): Fill {
  return { coin, px, sz: Math.abs(delta), side: delta > 0 ? 'B' : 'A', start, time, dir: dirOf(start, delta), closedPnl };
}

interface Account {
  address: string;
  name: string | null;
  cash: number; // collateral excluding open PnL
  positions: Pos[];
  history: Fill[];
}

const NOW = Date.now();
const NAMES = ['DemoPaus', 'contoh_whale', 'DemoSniper', 'paus_simulasi', 'DemoFund'];
const LEVS = [3, 5, 5, 10, 10, 15, 20, 20, 25, 40];
const accounts: Account[] = [];

function makePos(coin: Coin, usd: number, side: 1 | -1): Pos {
  const lev = Math.min(pick(LEVS), coin.maxLev);
  const entry = coin.px * (1 + (rnd() - 0.5) * 0.12);
  return {
    coin: coin.name,
    szi: (side * usd) / coin.px,
    entry,
    lev,
    type: rnd() < 0.8 ? 'cross' : 'isolated',
    openedAt: NOW - Math.floor(rnd() * 20 * 86_400_000),
  };
}

for (let i = 0; i < 46; i++) {
  const big = i < 34;
  const positions: Pos[] = [];
  const n = big ? 1 + Math.floor(rnd() * 3) : rnd() < 0.5 ? 1 : 0;
  const used = new Set<string>();
  for (let k = 0; k < n; k++) {
    const coin = k === 0 && i % 3 === 0 ? COINS[0] : weightedCoin();
    if (used.has(coin.name)) continue;
    used.add(coin.name);
    // log-uniform notional: $1.5M–$80M for whales, $150K–$1.5M for the rest
    const usd = big ? Math.exp(Math.log(1.5e6) + rnd() * Math.log(80 / 1.5)) : Math.exp(Math.log(1.5e5) + rnd() * Math.log(10));
    positions.push(makePos(coin, usd, rnd() < 0.55 ? 1 : -1));
  }
  const margin = positions.reduce((t, p) => t + (Math.abs(p.szi) * p.entry) / p.lev, 0);
  accounts.push({
    address: fakeAddr(),
    name: i < NAMES.length * 3 && i % 3 === 0 ? NAMES[i / 3] : null,
    cash: margin * (1.2 + rnd() * 2.5) + 120_000,
    positions,
    history: [],
  });
}
// A few smaller accounts so the scanner has something to sift through.
for (let i = 0; i < 70; i++) {
  accounts.push({ address: fakeAddr(), name: null, cash: 100_000 + rnd() * 900_000, positions: [], history: [] });
}
const byAddr = new Map(accounts.map((a) => [a.address, a]));
const retail = Array.from({ length: 300 }, () => fakeAddr());

// Fill history consistent with the positions held now: an opening fill (and
// sometimes a later add) for each position, plus closed round trips on other
// coins. Open times shown in the app are reconstructed from these fills.
for (const a of accounts.slice(0, 46)) {
  const r = mulberry32(parseInt(a.address.slice(10, 18), 16));
  for (const p of a.positions) {
    const first = r() < 0.5 ? p.szi : p.szi * 0.6;
    a.history.push(makeFill(p.coin, p.entry * (1 + (r() - 0.5) * 0.004), first, 0, p.openedAt));
    if (first !== p.szi) a.history.push(makeFill(p.coin, p.entry, p.szi - first, first, p.openedAt + (NOW - p.openedAt) * r()));
  }
  const others = COINS.filter((c) => !a.positions.some((p) => p.coin === c.name));
  for (let i = 0; i < 30; i++) {
    const coin = pick(others, r);
    const sz = ((2e4 + r() * 8e5) / coin.px) * (r() < 0.5 ? 1 : -1);
    const t0 = NOW - (1 + r() * 29) * 86_400_000;
    const t1 = t0 + r() * 86_400_000;
    const px0 = coin.px * (1 + (r() - 0.5) * 0.15);
    const px1 = px0 * (1 + (r() - 0.5) * 0.06);
    a.history.push(makeFill(coin.name, px0, sz, 0, t0));
    a.history.push(makeFill(coin.name, px1, -sz, sz, t1, (px1 - px0) * sz));
  }
  a.history.sort((x, y) => y.time - x.time);
}

function liqPx(p: Pos, a: Account): number | null {
  // Rough isolated-style estimate: price move that eats this position's share of collateral.
  const coin = coinMap.get(p.coin)!;
  const notional = Math.abs(p.szi) * coin.px;
  const total = a.positions.reduce((t, q) => t + Math.abs(q.szi) * coinMap.get(q.coin)!.px, 0) || 1;
  const collateral = p.type === 'isolated' ? (Math.abs(p.szi) * p.entry) / p.lev : equity(a) * (notional / total);
  const move = (collateral * 0.92) / Math.abs(p.szi);
  const px = p.szi > 0 ? coin.px - move : coin.px + move;
  return px > 0 ? px : null;
}

const upnl = (p: Pos) => p.szi * (coinMap.get(p.coin)!.px - p.entry);
const equity = (a: Account) => a.cash + a.positions.reduce((t, p) => t + upnl(p), 0);

function clearinghouse(user: string) {
  const a = byAddr.get(user.toLowerCase());
  const s = (n: number) => String(n);
  if (!a) {
    const ms = { accountValue: '0', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '0' };
    return { assetPositions: [], marginSummary: ms, crossMarginSummary: ms, crossMaintenanceMarginUsed: '0', withdrawable: '0', time: Date.now() };
  }
  let ntl = 0;
  let margin = 0;
  const assetPositions = a.positions.map((p) => {
    const px = coinMap.get(p.coin)!.px;
    const value = Math.abs(p.szi) * px;
    const used = value / p.lev;
    ntl += value;
    margin += used;
    const pnl = upnl(p);
    const hours = (Date.now() - p.openedAt) / 3_600_000;
    return {
      type: 'oneWay',
      position: {
        coin: p.coin,
        szi: s(p.szi),
        entryPx: s(p.entry),
        positionValue: s(value),
        unrealizedPnl: s(pnl),
        returnOnEquity: s(pnl / ((Math.abs(p.szi) * p.entry) / p.lev)),
        liquidationPx: liqPx(p, a) === null ? null : s(liqPx(p, a)!),
        leverage: { type: p.type, value: p.lev },
        marginUsed: s(used),
        maxLeverage: coinMap.get(p.coin)!.maxLev,
        cumFunding: { allTime: s(value * 0.002), sinceOpen: s(p.szi * px * (funding.get(p.coin) ?? 0) * hours), sinceChange: '0' },
      },
    };
  });
  const av = equity(a);
  const ms = { accountValue: s(av), totalNtlPos: s(ntl), totalRawUsd: s(a.cash), totalMarginUsed: s(margin) };
  return {
    assetPositions,
    marginSummary: ms,
    crossMarginSummary: ms,
    crossMaintenanceMarginUsed: s(margin / 2),
    withdrawable: s(Math.max(0, av - margin)),
    time: Date.now(),
  };
}

function leaderboard() {
  return {
    leaderboardRows: accounts.map((a, i) => {
      const r = mulberry32(i + 7);
      const av = equity(a);
      // Accounts with trade history (the first 46) get the larger, mostly positive results.
      const skill = i < 46 ? 0.25 + r() * 0.75 : r() * 0.3;
      const perf = (days: number) => {
        const pnl = av * (r() - 0.35) * skill * Math.sqrt(days / 30) * 0.6;
        return { pnl: String(pnl), roi: String(pnl / Math.max(av - pnl, 1)), vlm: String(av * days * (1 + r() * 4)) };
      };
      return {
        ethAddress: a.address,
        accountValue: String(av),
        displayName: a.name,
        prize: 0,
        windowPerformances: [
          ['day', perf(1)],
          ['week', perf(7)],
          ['month', perf(30)],
          ['allTime', perf(240)],
        ],
      };
    }),
  };
}

function candles(req: { coin: string; interval: string; startTime: number; endTime: number }) {
  const step = ({ '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5, '1w': 6048e5 } as Record<string, number>)[req.interval] ?? 36e5;
  const coin = coinMap.get(req.coin) ?? COINS[0];
  const r = mulberry32(req.coin.length * 977 + step / 1000);
  const last = Math.floor(req.endTime / step) * step;
  const out = [];
  let close = coin.px;
  const vol = Math.sqrt(step / 36e5) * 0.006;
  // Walk backwards from the live price so the last candle matches the mark.
  for (let t = last; t >= req.startTime && out.length < 600; t -= step) {
    const open = close * (1 + (r() - 0.5) * 2 * vol + Math.sin(t / step / 9) * vol * 0.4);
    const hi = Math.max(open, close) * (1 + r() * vol * 0.6);
    const lo = Math.min(open, close) * (1 - r() * vol * 0.6);
    out.push({ t, T: t + step - 1, s: coin.name, i: req.interval, o: String(open), c: String(close), h: String(hi), l: String(lo), v: String(r() * 1000), n: 50 });
    close = open;
  }
  return out.reverse();
}

function portfolio(user: string) {
  const a = byAddr.get(user.toLowerCase());
  const av = a ? equity(a) : 0;
  const r = mulberry32(parseInt(user.slice(10, 18), 16) || 1);
  const spans: [string, number][] = [
    ['day', 86_400_000],
    ['week', 7 * 86_400_000],
    ['month', 30 * 86_400_000],
    ['allTime', 240 * 86_400_000],
  ];
  const out: [string, unknown][] = [];
  for (const prefix of ['', 'perp']) {
    for (const [k, span] of spans) {
      const n = 60;
      const acct: [number, string][] = [];
      const pnl: [number, string][] = [];
      let v = av;
      let p = (r() - 0.35) * av * (span / (60 * 86_400_000) + 0.1);
      const endPnl = p;
      for (let i = n - 1; i >= 0; i--) {
        const t = Date.now() - ((n - 1 - i) * span) / (n - 1);
        acct.push([t, String(v)]);
        pnl.push([t, String(p)]);
        const d = (r() - 0.5) * av * 0.03;
        v -= d;
        p -= d + endPnl / n;
      }
      acct.reverse();
      pnl.reverse();
      const key = prefix ? `${prefix}${k[0].toUpperCase()}${k.slice(1)}` : k;
      out.push([key, { accountValueHistory: acct, pnlHistory: pnl, vlm: String(av * (span / 86_400_000) * 3) }]);
    }
  }
  return out;
}

function info(body: Record<string, unknown>): unknown {
  const user = String(body.user ?? '').toLowerCase();
  const a = byAddr.get(user);
  switch (body.type) {
    case 'metaAndAssetCtxs':
      return [
        { universe: COINS.map((c) => ({ name: c.name, szDecimals: c.szDec, maxLeverage: c.maxLev })) },
        COINS.map((c) => ({
          funding: String(funding.get(c.name)),
          openInterest: String((c.vol * 0.35) / c.px),
          prevDayPx: String(open0.get(c.name)),
          dayNtlVlm: String(c.vol),
          premium: '0',
          oraclePx: String(c.px),
          markPx: String(c.px),
          midPx: String(c.px),
        })),
      ];
    case 'allMids':
      return Object.fromEntries(COINS.map((c) => [c.name, String(c.px)]));
    case 'clearinghouseState':
      return clearinghouse(user);
    case 'spotClearinghouseState':
      return {
        balances: a
          ? [
              { coin: 'USDC', token: 0, total: String(a.cash * 0.08), hold: '0', entryNtl: '0' },
              { coin: 'HYPE', token: 150, total: String(Math.round(a.cash / 400)), hold: '0', entryNtl: String(a.cash / 12) },
            ]
          : [],
      };
    case 'frontendOpenOrders':
      return (a?.positions ?? []).flatMap((p, i) => {
        const px = coinMap.get(p.coin)!.px;
        const long = p.szi > 0;
        // As in the real API: prices have at most 5 significant figures, and triggerCondition
        // is English text that already includes the price ("Price below 100.0"), whatever the UI language.
        const trigger = String(Number((px * (long ? 0.91 : 1.09)).toPrecision(5)));
        return [
          {
            coin: p.coin, side: long ? 'A' : 'B', limitPx: String(px * (long ? 1.08 : 0.92)), sz: String(Math.abs(p.szi) / 2),
            oid: i * 2 + 1, timestamp: NOW - 7_200_000, orderType: 'Limit', reduceOnly: true, isTrigger: false, origSz: String(Math.abs(p.szi) / 2),
          },
          {
            coin: p.coin, side: long ? 'A' : 'B', limitPx: String(px * (long ? 0.9 : 1.1)), sz: '0', oid: i * 2 + 2,
            timestamp: NOW - 10_800_000, orderType: 'Stop Market', triggerPx: trigger,
            triggerCondition: `${long ? 'Price below' : 'Price above'} ${trigger}`, isTrigger: true, isPositionTpsl: true, reduceOnly: true,
          },
        ];
      });
    case 'userFills':
      return (a?.history ?? []).slice(0, 2000).map((h, i) => ({
        coin: h.coin, px: String(h.px), sz: String(h.sz), side: h.side, time: h.time, startPosition: String(h.start), dir: h.dir,
        closedPnl: String(h.closedPnl), hash: `0x${hex(64)}`, oid: i, crossed: true, fee: String(h.px * h.sz * 0.00035), tid: h.time + i,
      }));
    case 'portfolio':
      return portfolio(user);
    case 'userFunding': {
      const start = Number(body.startTime) || NOW - 7 * 86_400_000;
      const out = [];
      for (let t = Math.ceil(start / 3_600_000) * 3_600_000; t < Date.now() && out.length < 500; t += 3_600_000)
        for (const p of a?.positions ?? []) {
          const px = coinMap.get(p.coin)!.px;
          const rate = funding.get(p.coin)!;
          out.push({ time: t, hash: '0x0', delta: { type: 'funding', coin: p.coin, usdc: String(-p.szi * px * rate), szi: String(p.szi), fundingRate: String(rate) } });
        }
      return out.slice(0, 500);
    }
    case 'userNonFundingLedgerUpdates':
      return a
        ? [
            { time: NOW - 40 * 86_400_000, hash: `0x${hex(64)}`, delta: { type: 'deposit', usdc: String(Math.round(a.cash * 0.7)) } },
            { time: NOW - 12 * 86_400_000, hash: `0x${hex(64)}`, delta: { type: 'deposit', usdc: String(Math.round(a.cash * 0.4)) } },
            { time: NOW - 5 * 86_400_000, hash: `0x${hex(64)}`, delta: { type: 'withdraw', usdc: String(Math.round(a.cash * 0.1)), nonce: 1, fee: '1' } },
            { time: NOW - 2 * 86_400_000, hash: `0x${hex(64)}`, delta: { type: 'accountClassTransfer', usdc: '25000', toPerp: true } },
          ]
        : [];
    case 'candleSnapshot':
      return candles(body.req as { coin: string; interval: string; startTime: number; endTime: number });
    default:
      return extraInfo(body, { coins: COINS, funding }) ?? null;
  }
}

// ---------- trades & websocket ----------

type Listener = (fills: { user: string; fill: Record<string, unknown> }[]) => void;
const tradeListeners = new Set<(coin: string, trades: unknown[]) => void>();
const userFillListeners = new Set<Listener>();

let tradeId = 1;
function emitOrder(coin: Coin, taker: string, buy: boolean, usd: number) {
  const fillsN = usd > 5e5 ? 2 + Math.floor(Math.random() * 6) : 1;
  const hash = `0x${hex(64, Math.random)}`;
  const trades = [];
  const userFills = [];
  let px = coin.px;
  for (let i = 0; i < fillsN; i++) {
    const sz = usd / fillsN / px;
    const maker = Math.random() < 0.3 ? pick(accounts.slice(0, 34), Math.random).address : pick(retail, Math.random);
    trades.push({ coin: coin.name, side: buy ? 'B' : 'A', px: String(px), sz: String(sz), hash, time: Date.now(), tid: tradeId++, users: buy ? [taker, maker] : [maker, taker] });
    userFills.push({ user: taker, fill: { coin: coin.name, px: String(px), sz: String(sz), side: buy ? 'B' : 'A', time: Date.now(), hash, tid: tradeId, oid: tradeId, crossed: true, fee: String(sz * px * 0.00035), startPosition: '0', closedPnl: '0', dir: '' } });
    px *= 1 + (buy ? 1 : -1) * 0.00008;
  }
  coin.px = px;
  for (const l of tradeListeners) l(coin.name, trades);
  return userFills;
}

/** A whale trades: update its position, then publish the order to the feed. */
function whaleTrade() {
  const a = pick(accounts.slice(0, 34), Math.random);
  const existing = a.positions.length && Math.random() < 0.7 ? pick(a.positions, Math.random) : null;
  const coin = existing ? coinMap.get(existing.coin)! : weightedCoin();
  const usd = 6e5 + Math.random() * Math.random() * 1.4e7;
  const cur = existing ?? a.positions.find((p) => p.coin === coin.name);
  // Mostly add to the existing direction, sometimes take profit.
  const buy = cur ? (Math.random() < 0.72 ? cur.szi > 0 : cur.szi < 0) : Math.random() < 0.55;
  const delta = (buy ? 1 : -1) * (usd / coin.px);
  const start = cur?.szi ?? 0;
  let closedPnl = 0;
  if (!cur) {
    a.positions.push({ coin: coin.name, szi: delta, entry: coin.px, lev: Math.min(pick(LEVS, Math.random), coin.maxLev), type: 'cross', openedAt: Date.now() });
  } else if (Math.sign(delta) === Math.sign(cur.szi)) {
    cur.entry = (cur.entry * Math.abs(cur.szi) + coin.px * Math.abs(delta)) / (Math.abs(cur.szi) + Math.abs(delta));
    cur.szi += delta;
  } else {
    const closing = Math.min(Math.abs(delta), Math.abs(cur.szi));
    closedPnl = closing * (coin.px - cur.entry) * Math.sign(cur.szi);
    a.cash += closedPnl;
    cur.szi += delta;
    if (Math.abs(cur.szi) * coin.px < 5e4) a.positions = a.positions.filter((p) => p !== cur);
    else if (Math.sign(cur.szi) !== Math.sign(start)) {
      cur.entry = coin.px; // flipped: the remainder is a new position
      cur.openedAt = Date.now();
    }
  }
  const fill = makeFill(coin.name, coin.px, delta, start, Date.now(), closedPnl);
  a.history.unshift(fill);
  const fills = emitOrder(coin, a.address, buy, usd);
  for (const f of fills) Object.assign(f.fill, { dir: fill.dir, startPosition: String(start) });
  for (const l of userFillListeners) l(fills);
}

function retailTrades() {
  for (let i = 0; i < 3; i++) {
    const coin = weightedCoin();
    emitOrder(coin, pick(retail, Math.random), Math.random() < 0.5, 500 + Math.random() * Math.random() * 1.5e5);
  }
}

setInterval(retailTrades, 700);
(function loop() {
  whaleTrade();
  setTimeout(loop, 2500 + Math.random() * 4500);
})();

const RealWebSocket = window.WebSocket;

class DemoSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private coins = new Set<string>();
  private users = new Set<string>();
  private midsTimer: ReturnType<typeof setInterval> | undefined;
  private onTrades = (coin: string, trades: unknown[]) => {
    if (this.coins.has(coin)) this.push('trades', trades);
  };
  private onUserFills: Listener = (fills) => {
    const user = fills[0]?.user;
    if (user && this.users.has(user)) this.push('userFills', { user, fills: fills.map((f) => f.fill) });
  };

  constructor(url: string | URL, protocols?: string | string[]) {
    if (String(url) !== WS_URL) return new RealWebSocket(url, protocols) as unknown as DemoSocket;
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.(new Event('open'));
      tradeListeners.add(this.onTrades);
      userFillListeners.add(this.onUserFills);
    }, 150);
  }

  send(raw: string) {
    const msg = JSON.parse(raw) as { method: string; subscription?: { type: string; coin?: string; user?: string } };
    const sub = msg.subscription;
    if (msg.method === 'ping') return this.push('pong', {});
    if (!sub) return;
    const on = msg.method === 'subscribe';
    if (sub.type === 'trades' && sub.coin) on ? this.coins.add(sub.coin) : this.coins.delete(sub.coin);
    if (sub.type === 'userFills' && sub.user) {
      const u = sub.user.toLowerCase();
      if (on) {
        this.users.add(u);
        this.push('userFills', { isSnapshot: true, user: u, fills: [] });
      } else this.users.delete(u);
    }
    if (sub.type === 'allMids' && on && !this.midsTimer) {
      this.midsTimer = setInterval(() => this.push('allMids', { mids: Object.fromEntries(COINS.map((c) => [c.name, String(c.px)])) }), 1000);
    }
  }

  close() {
    this.readyState = 3;
    clearInterval(this.midsTimer);
    tradeListeners.delete(this.onTrades);
    userFillListeners.delete(this.onUserFills);
    this.onclose?.(new CloseEvent('close'));
  }

  private push(channel: string, data: unknown) {
    if (this.readyState !== 1) return;
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ channel, data }) }));
  }
}

const realFetch = window.fetch.bind(window);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function installDemo(): void {
  window.WebSocket = DemoSocket as unknown as typeof WebSocket;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === INFO_URL) {
      await delay(60 + Math.random() * 140);
      return json(info(JSON.parse(String(init?.body ?? '{}'))));
    }
    if (url === LEADERBOARD_URL) {
      await delay(400);
      return json(leaderboard());
    }
    if (url.endsWith('data/leaderboard.json')) return json({}, 404);
    return realFetch(input, init);
  };
}
