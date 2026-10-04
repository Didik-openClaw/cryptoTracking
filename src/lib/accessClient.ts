import { useEffect, useState } from 'react';
import { isEn, tr } from './i18n';

/** Browser side of the paid-access API (server/access.ts). */

export interface PublicConfig {
  price: number;
  normalPrice: number;
  promoEnd: number;
  whatsapp: string;
  paymentInfo: string;
  maxDevices: number;
  packages: number[];
  serverTime: number;
}

export interface Me {
  name: string;
  exp: number;
  code: string; // masked
  devicesUsed: number;
  maxDevices: number;
  serverTime: number;
}

export type CodeStatus = 'aktif' | 'habis' | 'dicabut';

export interface AccessCode {
  code: string;
  name: string;
  contact: string;
  note: string;
  months: number;
  createdAt: number;
  exp: number;
  revoked: boolean;
  devices: string[];
  orderId?: string;
  status: CodeStatus;
}

export interface Order {
  id: string;
  name: string;
  contact: string;
  months: number;
  total: number;
  createdAt: number;
  status: 'baru' | 'selesai' | 'batal';
  code?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/**
 * Readable text per error code. English always uses its own text for a known code; Indonesian prefers the
 * server's message (Indonesian, more specific) and falls back to `id` when the server sends none.
 */
const ERROR_TEXT: Record<string, { id?: string; en: string }> = {
  invalid: { id: 'Kode akses tidak ditemukan.', en: 'Access code not found. Check the code (format DTY-XXXX-XXXX-XXXX).' },
  expired: { id: 'Masa akses sudah habis.', en: 'This access has expired. Renew it via WhatsApp.' },
  revoked: { id: 'Kode akses sudah dinonaktifkan.', en: 'This access code has been deactivated. Contact the admin.' },
  device_limit: {
    id: 'Batas perangkat untuk kode ini sudah penuh.',
    en: 'This code is already in use on the maximum number of devices. Log out on an old device or ask the admin to reset them.',
  },
  unauthorized: { id: 'Password admin salah.', en: 'Wrong admin password.' },
  name: { en: 'Please enter a name (at least 2 characters).' },
  contact: { en: 'Invalid WhatsApp number.' },
  months: { en: 'Please choose an available package.' },
  busy: { en: 'Too many open orders right now. Please contact the admin on WhatsApp.' },
  not_found: { en: 'Not found. It may already have been deleted.' },
};

/** JSON call to /api/*; throws ApiError with a readable message in the interface language. */
export async function api<T>(path: string, init: RequestInit & { admin?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.admin) headers.set('Authorization', `Bearer ${init.admin}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError(
      tr('Tidak bisa terhubung ke server. Periksa koneksi internet.', 'Cannot reach the server. Check your internet connection.'),
      0,
      'network',
    );
  }
  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    const code = data?.error ?? String(res.status);
    const known = ERROR_TEXT[code];
    const fallback =
      res.status === 404
        ? tr(
            'Server akses belum aktif (situs belum di-deploy ke Netlify?).',
            'The access server is not live yet (site not deployed to Netlify?).',
          )
        : `Server error ${res.status}`;
    const msg = isEn() ? (known?.en ?? data?.message ?? fallback) : (data?.message ?? known?.id ?? fallback);
    throw new ApiError(msg, res.status, code);
  }
  return data as T;
}

export const fmtRupiah = (n: number) => `Rp ${Math.round(n).toLocaleString('id-ID')}`;

/** wa.me link; `phone` in international digits (62…). */
export const waLink = (phone: string, message: string) =>
  `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

const pad = (n: number) => String(n).padStart(2, '0');

export interface Remaining {
  done: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function remaining(ms: number): Remaining {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { done: t <= 0, days: Math.floor(t / 86_400), hours: Math.floor(t / 3600) % 24, minutes: Math.floor(t / 60) % 60, seconds: t % 60 };
}

/** "23 hari 04:12:33" / "23 days 04:12:33" (or "04:12:33" under a day); compact "23hr …" / "23d …". */
export function fmtCountdown(ms: number, compact = false): string {
  const r = remaining(ms);
  const clock = `${pad(r.hours)}:${pad(r.minutes)}:${pad(r.seconds)}`;
  if (!r.days) return clock;
  const unit = compact ? tr('hr', 'd') : tr(' hari', r.days === 1 ? ' day' : ' days');
  return `${r.days}${unit} ${clock}`;
}

/** Current time corrected by the server clock, re-rendering every `every` ms. */
export function useNow(every = 1000, serverOffset = 0): number {
  const [now, setNow] = useState(() => Date.now() + serverOffset);
  useEffect(() => {
    setNow(Date.now() + serverOffset);
    const t = setInterval(() => setNow(Date.now() + serverOffset), every);
    return () => clearInterval(t);
  }, [every, serverOffset]);
  return now;
}

/** "04 Okt 2026, 14:05" / "04 Oct 2026, 14:05" (en-GB: same layout and 24-hour clock as the Indonesian one). */
export const fmtDate = (ms: number) =>
  new Date(ms)
    .toLocaleString(tr('id-ID', 'en-GB'), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    .replace(/\./g, ':');
