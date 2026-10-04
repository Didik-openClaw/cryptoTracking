import { useSyncExternalStore } from 'react';

/**
 * Base class for the app's long-lived engines (scanner, live feed, watchlist…).
 * They mutate internal state freely and call `emit()`; React components
 * subscribe through `useObservable` and re-render on a throttled version bump,
 * so a burst of websocket messages costs at most a few renders per second.
 */
export class Observable {
  private observers = new Set<() => void>();
  private version = 0;
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(private throttleMs = 250) {}

  subscribe = (listener: () => void): (() => void) => {
    this.observers.add(listener);
    return () => {
      this.observers.delete(listener);
    };
  };

  getVersion = (): number => this.version;

  protected emit(immediate = false): void {
    if (immediate) {
      if (this.pending) clearTimeout(this.pending);
      this.notifyNow();
      return;
    }
    if (this.pending) return;
    this.pending = setTimeout(this.notifyNow, this.throttleMs);
  }

  private notifyNow = (): void => {
    this.pending = null;
    this.version++;
    for (const l of this.observers) l();
  };
}

export function useObservable(o: Observable): number {
  return useSyncExternalStore(o.subscribe, o.getVersion);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
