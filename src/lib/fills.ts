import { getUserFills, limiter, Priority } from './api';
import { Observable, sleep } from './observable';
import type { HLFill } from './types';

/**
 * Shared, rate-aware fetcher for a wallet's recent fills (userFills, up to
 * 2000). One response feeds every consumer: position open times and trader
 * statistics.
 *
 * - Interactive requests (a page the user is looking at) go first at user
 *   priority.
 * - Background requests pace themselves to BUDGET_SHARE of the request budget,
 *   since a single response can cost 120 weight (60 position scans).
 */
const BUDGET_SHARE = 0.3;

type Listener = (address: string, fills: HLFill[]) => void;

class FillsService extends Observable {
  private queue: { address: string; interactive: boolean }[] = [];
  private inFlight = new Set<string>();
  private listeners = new Set<Listener>();
  private running = false;
  private nextBackgroundAt = 0;

  constructor() {
    super(300);
  }

  onFills(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  isPending(address: string): boolean {
    return this.inFlight.has(address) || this.queue.some((q) => q.address === address);
  }

  request(address: string, interactive = false): void {
    if (this.inFlight.has(address)) return;
    const queued = this.queue.find((q) => q.address === address);
    if (queued) {
      queued.interactive ||= interactive;
      return;
    }
    this.queue.push({ address, interactive });
    this.emit();
    void this.run();
  }

  /** Hand fills fetched elsewhere (the wallet page) to every consumer. */
  publish(address: string, fills: HLFill[]): void {
    for (const l of this.listeners) l(address, fills);
    this.emit();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const i = this.queue.findIndex((q) => q.interactive);
        let job;
        if (i >= 0) job = this.queue.splice(i, 1)[0];
        else if (Date.now() >= this.nextBackgroundAt) job = this.queue.shift()!;
        else {
          await sleep(Math.min(500, this.nextBackgroundAt - Date.now()));
          continue;
        }
        this.inFlight.add(job.address);
        this.emit();
        try {
          const fills = await getUserFills(job.address, undefined, job.interactive ? Priority.Bulk : Priority.Scan);
          this.publish(job.address, fills);
          if (!job.interactive) {
            const weight = 20 + Math.floor(fills.length / 20);
            this.nextBackgroundAt = Date.now() + (weight / (limiter.rate * BUDGET_SHARE)) * 60_000;
          }
        } catch {
          /* consumers simply stay without data; a later request retries */
        } finally {
          this.inFlight.delete(job.address);
          this.emit();
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const fillsService = new FillsService();
