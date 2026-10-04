import { Observable } from './observable';
import { settings } from './settings';
import { beep } from './sound';

export interface Toast {
  id: number;
  title: string;
  body: string;
  severity: 'info' | 'warn' | 'danger';
  href?: string;
}

const TOAST_MS = 9000;

class Notifier extends Observable {
  toasts: Toast[] = [];
  private seq = 0;

  constructor() {
    super(0);
  }

  get permission(): NotificationPermission | 'unsupported' {
    return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  }

  async requestPermission(): Promise<void> {
    if (typeof Notification === 'undefined') return;
    await Notification.requestPermission();
    this.emit(true);
  }

  push(t: Omit<Toast, 'id'>, opts: { browser?: boolean; sound?: boolean } = {}): void {
    const toast = { ...t, id: ++this.seq };
    this.toasts = [toast, ...this.toasts].slice(0, 5);
    this.emit(true);
    setTimeout(() => this.dismiss(toast.id), TOAST_MS);

    const s = settings.value;
    if ((opts.sound ?? true) && s.alertSound) beep(t.severity === 'danger' ? 440 : 880, t.severity === 'danger' ? 0.3 : 0.12);
    if ((opts.browser ?? true) && s.browserNotifications && this.permission === 'granted') {
      try {
        const n = new Notification(t.title, { body: t.body, tag: `${t.title}|${t.body}`.slice(0, 120) });
        n.onclick = () => {
          window.focus();
          if (t.href) location.hash = t.href;
          n.close();
        };
      } catch {
        /* some mobile browsers only allow notifications from a service worker */
      }
    }
  }

  dismiss(id: number): void {
    const next = this.toasts.filter((t) => t.id !== id);
    if (next.length === this.toasts.length) return;
    this.toasts = next;
    this.emit(true);
  }
}

export const notifier = new Notifier();
