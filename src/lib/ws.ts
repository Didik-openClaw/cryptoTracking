import { WS_URL } from './api';
import { Observable } from './observable';

type Sub = Record<string, unknown> & { type: string };
type Handler = (data: unknown) => void;

const keyOf = (s: Sub) => JSON.stringify(s, Object.keys(s).sort());

/**
 * Single shared websocket to Hyperliquid with automatic reconnect and
 * resubscription. Hyperliquid closes idle sockets after 60s, so we ping.
 */
export class HLSocket extends Observable {
  status: 'connecting' | 'open' | 'closed' = 'closed';
  messages = 0;
  private ws: WebSocket | null = null;
  private subs = new Map<string, Sub>();
  private handlers = new Map<string, Set<Handler>>();
  private retry = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(private url = WS_URL) {
    super(1000);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  on(channel: string, h: Handler): () => void {
    let set = this.handlers.get(channel);
    if (!set) this.handlers.set(channel, (set = new Set()));
    set.add(h);
    return () => set!.delete(h);
  }

  addSubscription(sub: Sub): void {
    const k = keyOf(sub);
    if (this.subs.has(k)) return;
    this.subs.set(k, sub);
    this.send({ method: 'subscribe', subscription: sub });
  }

  removeSubscription(sub: Sub): void {
    const k = keyOf(sub);
    if (!this.subs.delete(k)) return;
    this.send({ method: 'unsubscribe', subscription: sub });
  }

  /** Replace every subscription of `type` with `wanted`. */
  syncType(type: string, wanted: Sub[]): void {
    const want = new Map(wanted.map((s) => [keyOf(s), s]));
    for (const [k, s] of [...this.subs]) if (s.type === type && !want.has(k)) this.removeSubscription(s);
    for (const s of want.values()) this.addSubscription(s);
  }

  subscriptionCount(type?: string): number {
    if (!type) return this.subs.size;
    let n = 0;
    for (const s of this.subs.values()) if (s.type === type) n++;
    return n;
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect(): void {
    this.status = 'connecting';
    this.emit();
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'open';
      this.retry = 0;
      for (const s of this.subs.values()) this.send({ method: 'subscribe', subscription: s });
      this.pingTimer = setInterval(() => this.send({ method: 'ping' }), 30_000);
      this.emit();
    };
    ws.onmessage = (ev) => {
      this.messages++;
      let msg: { channel?: string; data?: unknown };
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (!msg.channel) return;
      const set = this.handlers.get(msg.channel);
      if (set) for (const h of set) h(msg.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.status = 'closed';
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.emit();
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 1000 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }
}

export const socket = new HLSocket();
