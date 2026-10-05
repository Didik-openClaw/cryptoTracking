import { describe, expect, it } from 'vitest';
import {
  allocateTps,
  breakEvenPrice,
  calculate,
  floorTo,
  fundingCost,
  isolatedLiqPrice,
  lossPerCoin,
  roundPx,
  splitSize,
  type CalcInput,
} from './riskCalc';

const base: CalcInput = {
  side: 'long',
  account: 10_000,
  riskMode: 'pct',
  risk: 1,
  entry: 60_000,
  stop: 59_400,
  tps: [
    { price: 61_200, pct: 50 },
    { price: 62_400, pct: 50 },
    { price: 0, pct: 0 },
  ],
  leverage: 10,
  maxLeverage: 40,
  szDecimals: 5,
  marginMode: 'isolated',
  takerFee: 0.00045,
  makerFee: 0.00015,
  entryOrder: 'market',
  tpOrder: 'limit',
  fundingRate: 0.0000125,
  holdHours: 24,
};

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('risk calculator helpers', () => {
  it('rounds sizes down and prices to Hyperliquid tick rules', () => {
    expect(floorTo(0.29, 2)).toBe(0.29);
    expect(floorTo(0.15296899, 5)).toBe(0.15296);
    expect(floorTo(-1, 2)).toBe(0);
    expect(roundPx(61234.567, 5)).toBe(61235);
    expect(roundPx(0.000123456, 0)).toBe(0.000123);
    expect(roundPx(123456.7, 2)).toBe(123457);
  });

  it('counts fees in the loss per coin and the break-even price', () => {
    // 600 move + 60 000 × 0.045 % + 59 400 × 0.045 % = 600 + 27 + 26.73
    close(lossPerCoin('long', 60_000, 59_400, 0.00045, 0.00045), 653.73);
    close(lossPerCoin('short', 100, 102, 0.001, 0.001), 2 + 0.1 + 0.102);
    close(breakEvenPrice('long', 100, 0.001, 0.001), 100.2002002);
    close(breakEvenPrice('short', 100, 0.001, 0.001), 99.8001998);
  });

  it('longs pay positive funding, shorts receive it', () => {
    close(fundingCost('long', 10_000, 0.0001, 8), 8);
    close(fundingCost('short', 10_000, 0.0001, 8), -8);
  });

  it('estimates the isolated liquidation price from the maintenance margin', () => {
    // mm = 1 / (2 × 40) = 1.25 %; long 10×: 60 000 × (1 − (0.1 − 0.0125) / (1 − 0.0125))
    close(isolatedLiqPrice('long', 60_000, 10, 40)!, 60_000 * (1 - 0.0875 / 0.9875), 1e-6);
    close(isolatedLiqPrice('short', 60_000, 10, 40)!, 60_000 * (1 + 0.0875 / 1.0125), 1e-6);
    // 1× long at max leverage 40 is never liquidated
    expect(isolatedLiqPrice('long', 60_000, 1, 1)).toBeNull();
  });

  it('splits take-profits without exceeding 100 %', () => {
    expect(allocateTps([50, 50])).toEqual({ shares: [0.5, 0.5], over: false, under: false });
    expect(allocateTps([70, 70]).shares).toEqual([0.7, 0.3]);
    expect(allocateTps([70, 70]).over).toBe(true);
    expect(allocateTps([30, 30]).shares).toEqual([0.3, 0.7]); // the rest closes at the last TP
    expect(splitSize(0.15296, [0.5, 0.5], 5)).toEqual([0.07648, 0.07648]);
    expect(splitSize(1, [1 / 3, 1 / 3, 1 / 3], 2)).toEqual([0.33, 0.33, 0.34]);
  });
});

describe('calculate', () => {
  it('sizes a long so the stop loses at most the risk budget', () => {
    const r = calculate(base);
    expect(r.ok).toBe(true);
    expect(r.budget).toBe(100);
    close(r.lossPerCoin, 653.73);
    expect(r.size).toBe(0.15296); // 100 / 653.73 = 0.152968… floored to 5 decimals
    close(r.notional, 0.15296 * 60_000);
    close(r.margin, (0.15296 * 60_000) / 10);
    close(r.maxLoss, 0.15296 * 653.73);
    expect(r.maxLoss).toBeLessThanOrEqual(100);
    close(r.stopPct, 0.01);
    expect(r.minLeverage).toBe(1);
    close(r.fundingCost, 0.15296 * 60_000 * 0.0000125 * 24);
    expect(r.warnings).toEqual([]);
  });

  it('prices each take-profit with maker fees and R multiples', () => {
    const r = calculate(base);
    expect(r.tps.map((t) => t.size)).toEqual([0.07648, 0.07648]);
    // TP1 per coin: 1 200 − 60 000 × 0.045 % − 61 200 × 0.015 % = 1 200 − 27 − 9.18
    close(r.tps[0].pnl, 0.07648 * (1200 - 27 - 9.18));
    close(r.tps[0].r, (1200 - 27 - 9.18) / 653.73);
    close(r.tps[0].rGross, 2);
    close(r.tps[1].rGross, 4);
    close(r.blendedR!, r.tpPnl / r.maxLoss);
  });

  it('handles shorts, fixed-USD risk and cross margin', () => {
    const r = calculate({
      ...base,
      side: 'short',
      riskMode: 'usd',
      risk: 250,
      entry: 3000,
      stop: 3090,
      tps: [{ price: 2820, pct: 100 }],
      szDecimals: 4,
      maxLeverage: 25,
      leverage: 5,
      marginMode: 'cross',
    });
    expect(r.ok).toBe(true);
    // loss per coin = 90 + 3000 × 0.045 % + 3090 × 0.045 % = 90 + 1.35 + 1.3905
    close(r.lossPerCoin, 92.7405);
    expect(r.size).toBe(floorTo(250 / 92.7405, 4));
    expect(r.liq).toBe(r.liqCross);
    expect(r.liq!).toBeGreaterThan(3090); // cross with the whole account: far above the stop
    expect(r.tps[0].rGross).toBe(2);
  });

  it('warns when the stop sits beyond the liquidation price', () => {
    const r = calculate({ ...base, stop: 50_000, leverage: 20, risk: 1 });
    expect(r.ok).toBe(true);
    expect(r.liq!).toBeGreaterThan(50_000);
    expect(r.warnings).toContain('stopBeyondLiq');
  });

  it('flags bad inputs instead of computing', () => {
    expect(calculate({ ...base, stop: 60_500 }).errors).toEqual(['stopSide']);
    expect(calculate({ ...base, account: 0 }).errors).toContain('account');
    expect(calculate({ ...base, leverage: 50 }).errors).toEqual(['leverage']);
    expect(calculate({ ...base, risk: 0.000001 }).errors).toEqual(['sizeZero']);
    expect(calculate({ ...base, tps: [{ price: 59_000, pct: 100 }] }).warnings).toContain('tpWrongSide');
    expect(calculate({ ...base, risk: 5 }).warnings).toContain('highRisk');
  });
});
