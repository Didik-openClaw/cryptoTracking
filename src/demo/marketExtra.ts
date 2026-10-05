import type { DemoMarket } from './extra';

/** Demo for market-wide requests (predictedFundings, fundingHistory). Returns undefined for other types. */
export function marketInfo(_body: Record<string, unknown>, _market: DemoMarket): unknown {
  return undefined;
}
