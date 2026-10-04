import { fmtCountdown, type Me } from './accessClient';
import { tr } from './i18n';
import { mode } from './mode';
import { notifier } from './notify';
import { Observable } from './observable';

const CHECK_MS = 30 * 60_000;
const WARN_MS = 3 * 86_400_000;

/**
 * The visitor's paid access, from /api/me. The edge gate already keeps
 * visitors without a session out; this adds the remaining-time countdown,
 * an early renewal reminder, and sends the browser to the buy page when the
 * code ends while the terminal is open.
 *
 * status "none" means no access server answered (local `npm run dev`, or a
 * plain static host without the Netlify functions); the terminal then runs
 * without the access UI.
 */
class AccessState extends Observable {
  status: 'checking' | 'none' | 'active' = 'checking';
  me: Me | null = null;
  /** server clock minus local clock, so countdowns match the server */
  offset = 0;
  private warned = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super(0);
  }

  start(): void {
    if (mode.demo) {
      this.status = 'none';
      return;
    }
    void this.check();
    setInterval(() => void this.check(), CHECK_MS);
  }

  async check(): Promise<void> {
    let res: Response;
    try {
      res = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' });
    } catch {
      if (this.status === 'checking') this.status = 'none';
      this.emit(true);
      return;
    }
    const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
    if (res.status === 401 && isJson) {
      const { error } = (await res.json().catch(() => ({}))) as { error?: string };
      location.assign(`/beli/?alasan=${encodeURIComponent(error ?? 'session')}`);
      return;
    }
    if (!res.ok || !isJson) {
      this.status = 'none';
      this.emit(true);
      return;
    }
    const me = (await res.json()) as Me;
    this.me = me;
    this.offset = me.serverTime - Date.now();
    this.status = 'active';
    this.scheduleExpiry();
    const left = me.exp - (Date.now() + this.offset);
    if (left < WARN_MS && !this.warned) {
      this.warned = true;
      const time = fmtCountdown(left);
      notifier.push(
        {
          title: tr('Akses hampir habis', 'Access expiring soon'),
          body: tr(
            `Sisa ${time}. Klik chip AKSES di header untuk perpanjang.`,
            `${time} left. Click the ACCESS chip in the header to renew.`,
          ),
          severity: 'warn',
        },
        { browser: false },
      );
    }
    this.emit(true);
  }

  /** Re-check right after the code expires so the buyer lands on the renewal page. */
  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (!this.me) return;
    const ms = this.me.exp - (Date.now() + this.offset) + 2000;
    // setTimeout overflows above ~24.8 days; the periodic check covers longer spans.
    if (ms < 2 ** 31 - 1) this.expiryTimer = setTimeout(() => void this.check(), Math.max(0, ms));
  }
}

export const access = new AccessState();
