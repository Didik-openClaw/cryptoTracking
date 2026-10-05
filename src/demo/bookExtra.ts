import type { DemoMarket } from './extra';

/** Rounds to `sig` significant figures (as Hyperliquid's nSigFigs aggregation does). */
function sigRound(px: number, sig: number, mode: 'floor' | 'ceil'): number {
  const p = 10 ** (Math.floor(Math.log10(px)) - sig + 1);
  return (mode === 'floor' ? Math.floor(px / p) : Math.ceil(px / p)) * p;
}

const fmt = (px: number) => String(Number(px.toPrecision(6)));

/** Demo for order book requests (l2Book): 20 levels per side around the coin's price with a few walls. */
export function bookInfo(body: Record<string, unknown>, market: DemoMarket): unknown {
  if (body.type !== 'l2Book') return undefined;
  const coin = market.coins.find((c) => c.name === body.coin);
  if (!coin) return null;
  const sig = typeof body.nSigFigs === 'number' ? body.nSigFigs : null;
  const now = Date.now();
  const wobble = Math.sin(now / 7000) * 0.0004;
  const mid = coin.px * (1 + wobble);
  const tick = sig ? 10 ** (Math.floor(Math.log10(mid)) - sig + 1) : mid * 0.00005;
  const levelUsd = coin.vol / 4000; // a liquid coin has bigger levels
  const side = (dir: 1 | -1) => {
    const out: { px: string; sz: string; n: number }[] = [];
    let px = dir === -1 ? (sig ? sigRound(mid, sig, 'floor') : mid - tick / 2) : sig ? sigRound(mid, sig, 'ceil') : mid + tick / 2;
    for (let i = 0; i < 20; i++) {
      const seed = Math.abs(Math.sin((i + 1) * 12.9898 * dir + Math.floor(now / 3000) * 0.37));
      let usd = levelUsd * (0.3 + seed * 1.6) * (1 + i * 0.08);
      // Fixed walls a little away from mid so they persist between refreshes.
      if (i === 6 || i === 15) usd *= dir === -1 ? 9 : 7;
      out.push({ px: fmt(px), sz: String(Number((usd / px).toPrecision(5))), n: 1 + Math.floor(seed * 12) });
      px += dir * tick * (sig ? 1 : 1 + Math.floor(seed * 3));
    }
    return out;
  };
  return { coin: coin.name, time: now, levels: [side(-1), side(1)] };
}
