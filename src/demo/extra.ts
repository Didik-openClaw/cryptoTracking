// Demo answers for the info requests added by the pro features. Each feature
// keeps its simulation in its own module; install.ts passes the demo market in.
import { bookInfo } from './bookExtra';
import { marketInfo } from './marketExtra';

export interface DemoCoin {
  name: string;
  px: number;
  maxLev: number;
  vol: number;
}

export interface DemoMarket {
  coins: DemoCoin[];
  /** Current hourly funding per coin. */
  funding: Map<string, number>;
}

/** Returns undefined when no pro-feature module handles this request type. */
export function extraInfo(body: Record<string, unknown>, market: DemoMarket): unknown {
  for (const handler of [marketInfo, bookInfo]) {
    const r = handler(body, market);
    if (r !== undefined) return r;
  }
  return undefined;
}
