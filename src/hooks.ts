import { useMemo } from 'react';
import { market } from './lib/market';
import { useObservable } from './lib/observable';
import { scanner } from './lib/scanner';
import type { LivePosition } from './lib/types';

/** Every scanned position worth at least `minUsd`, re-priced with live mids. */
export function useWhalePositions(minUsd: number): LivePosition[] {
  const sv = useObservable(scanner);
  const mv = useObservable(market);
  return useMemo(() => scanner.livePositions(market.mids, minUsd), [sv, mv, minUsd]);
}
