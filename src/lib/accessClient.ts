import { useEffect, useState } from 'react';

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

const ERROR_TEXT: Record<string, string> = {
  invalid: 'Kode akses tidak ditemukan.',
  expired: 'Masa akses sudah habis.',
  revoked: 'Kode akses sudah dinonaktifkan.',
  device_limit: 'Batas perangkat untuk kode ini sudah penuh.',
  unauthorized: 'Password admin salah.',
};

/** JSON call to /api/*; throws ApiError with a readable Indonesian message. */
export async function api<T>(path: string, init: RequestInit & { admin?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (init.admin) headers.set('Authorization', `Bearer ${init.admin}`);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError('Tidak bisa terhubung ke server. Periksa koneksi internet.', 0, 'network');
  }
  const data = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) {
    const code = data?.error ?? String(res.status);
    const msg =
      data?.message ??
      ERROR_TEXT[code] ??
      (res.status === 404 ? 'Server akses belum aktif (situs belum di-deploy ke Netlify?).' : `Server error ${res.status}`);
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

/** "23 hari 04:12:33" (or "04:12:33" under a day). */
export function fmtCountdown(ms: number, compact = false): string {
  const r = remaining(ms);
  const clock = `${pad(r.hours)}:${pad(r.minutes)}:${pad(r.seconds)}`;
  if (!r.days) return clock;
  return `${r.days}${compact ? 'hr' : ' hari'} ${clock}`;
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

export const fmtDate = (ms: number) =>
  new Date(ms).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/\./g, ':');
