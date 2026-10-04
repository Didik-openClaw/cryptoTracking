/**
 * Token bucket measured in Hyperliquid "weight". The public API allows
 * 1200 weight per minute per IP (clearinghouseState = 2, most other info
 * requests = 20, plus extra weight for large responses).
 *
 * Waiters are served by priority (higher first), FIFO within a priority, so a
 * user opening a wallet page is not stuck behind the background scanner.
 * Priority-0 (background) requests also leave `reserve` tokens untouched, so
 * there is always burst budget for interactive requests.
 */
interface Waiter {
  weight: number;
  priority: number;
  seq: number;
  resolve: () => void;
}

export class WeightLimiter {
  private tokens: number;
  private last: number;
  private queue: Waiter[] = [];
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pausedUntil = 0;

  private capacity: number;
  private reserve: number;
  private now: () => number;

  constructor(
    private perMinute: number,
    opts: { capacity?: number; reserve?: number; now?: () => number } = {},
  ) {
    this.capacity = opts.capacity ?? 120;
    this.reserve = Math.min(opts.reserve ?? 0, this.capacity);
    this.now = opts.now ?? (() => Date.now());
    this.tokens = this.capacity;
    this.last = this.now();
  }

  setRate(perMinute: number): void {
    this.refill();
    this.perMinute = Math.max(60, perMinute);
    this.pump();
  }

  get rate(): number {
    return this.perMinute;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Charge weight after the fact (Hyperliquid adds weight for large responses). */
  charge(weight: number): void {
    if (weight <= 0) return;
    this.refill();
    this.tokens -= weight;
  }

  /** Stop serving requests for `ms` (used after an HTTP 429). */
  pause(ms: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
    this.tokens = Math.min(this.tokens, 0);
    this.schedule(ms);
  }

  get pausedFor(): number {
    return Math.max(0, this.pausedUntil - this.now());
  }

  acquire(weight: number, priority = 0): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ weight, priority, seq: this.seq++, resolve });
      this.queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
      this.pump();
    });
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.last;
    this.last = t;
    this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.perMinute) / 60_000);
  }

  private pump = (): void => {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.refill();
    const wait = this.pausedUntil - this.now();
    if (wait > 0) {
      this.schedule(wait);
      return;
    }
    while (this.queue.length) {
      const head = this.queue[0];
      // Requests heavier than the bucket are let through once it is full and
      // may push the balance negative; later requests then wait it out.
      const need = Math.min(head.weight + (head.priority <= 0 ? this.reserve : 0), this.capacity);
      if (this.tokens < need) {
        this.schedule(((need - this.tokens) * 60_000) / this.perMinute);
        return;
      }
      this.tokens -= head.weight;
      this.queue.shift();
      head.resolve();
    }
  };

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.pump, Math.max(5, Math.ceil(ms)));
  }
}
