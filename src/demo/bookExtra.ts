import type { DemoMarket } from './extra';

/** Demo for order book requests (l2Book). Returns undefined for other types. */
export function bookInfo(_body: Record<string, unknown>, _market: DemoMarket): unknown {
  return undefined;
}
