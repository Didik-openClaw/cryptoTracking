import { fillsService } from './fills';
import { Observable } from './observable';
import { computeTraderStats, type TraderStats } from './stats';
import { load, save } from './storage';

/** Trader statistics per wallet, computed from its recent fills and cached in the browser. */
const FRESH_MS = 6 * 60 * 60_000;
const MAX_ENTRIES = 600;

interface Entry {
  stats: TraderStats;
  at: number;
}

// JSON has no Infinity (a profit factor with no losing trade).
const encode = (e: Entry) => ({ ...e, stats: { ...e.stats, profitFactor: e.stats.profitFactor === Infinity ? 'inf' : e.stats.profitFactor } });
const decode = (e: ReturnType<typeof encode>): Entry => ({
  ...e,
  stats: { ...e.stats, profitFactor: e.stats.profitFactor === 'inf' ? Infinity : (e.stats.profitFactor as number | null) },
});

class TraderStatsStore extends Observable {
  private cache = new Map<string, Entry>(
    load<[string, ReturnType<typeof encode>][]>('tstats', []).map(([a, e]) => [a, decode(e)]),
  );

  constructor() {
    super(300);
    fillsService.onFills((address, fills) => {
      this.cache.set(address, { stats: computeTraderStats(fills), at: Date.now() });
      this.persist();
      this.emit();
    });
    fillsService.subscribe(() => this.emit());
  }

  get(address: string): Entry | undefined {
    return this.cache.get(address);
  }

  isPending(address: string): boolean {
    return fillsService.isPending(address);
  }

  /** Load stats for a wallet the user is looking at (skips fresh cache). */
  request(address: string, force = false): void {
    const e = this.cache.get(address);
    if (!force && e && Date.now() - e.at < FRESH_MS) return;
    fillsService.request(address, true);
  }

  private persist(): void {
    if (this.cache.size > MAX_ENTRIES) {
      this.cache = new Map([...this.cache].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_ENTRIES));
    }
    save('tstats', [...this.cache].map(([a, e]) => [a, encode(e)]));
  }
}

export const traderStats = new TraderStatsStore();
