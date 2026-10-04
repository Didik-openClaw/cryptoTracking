/**
 * Paid access for DTY Crypto Terminal.
 *
 * Runtime-agnostic (Web Crypto + Fetch API only): used by the Netlify edge
 * gate (Deno), the Netlify API function (Node), the VPS/local server in
 * server/node.mjs and the unit tests. Keep to erasable TypeScript
 * syntax and `.ts` import paths so Deno and Node's type stripping can load it.
 *
 * Model
 * - The admin sells access by month and creates an access code per buyer
 *   (DTY-XXXX-XXXX-XXXX). Codes live in a key-value Store with buyer info,
 *   expiry, revocation flag and the devices that activated them.
 * - Activating a code sets a signed session cookie. The edge gate only checks
 *   the signature and a short session expiry (24h), so it needs no storage.
 *   When the session expires the gate sends the browser through /api/refresh,
 *   which re-reads the code (catching revocation, expiry and removed
 *   devices) and issues a new session.
 */

export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface Env {
  sessionSecret: string;
  adminPassword: string;
  now?: () => number;
}

export const DAY_MS = 86_400_000;
/** One sold month. */
export const MONTH_MS = 30 * DAY_MS;
export const SESSION_MS = DAY_MS;
export const SESSION_COOKIE = 'dty_s';
export const DEVICE_COOKIE = 'dty_d';
export const BUY_PATH = '/beli/';
const DEVICE_COOKIE_DAYS = 400;
const MAX_OPEN_ORDERS = 500;

export interface AccessCode {
  code: string;
  name: string;
  contact: string;
  note: string;
  months: number; // total months sold on this code
  createdAt: number;
  exp: number;
  revoked: boolean;
  devices: string[];
  orderId?: string;
  log: { at: number; action: string; months?: number }[];
}

export type CodeStatus = 'aktif' | 'habis' | 'dicabut';
export type OrderStatus = 'baru' | 'selesai' | 'batal';

export interface Order {
  id: string;
  name: string;
  contact: string;
  months: number;
  total: number;
  createdAt: number;
  status: OrderStatus;
  code?: string;
}

export interface SalesConfig {
  price: number; // IDR per month
  normalPrice: number; // struck-through price during a promo, 0 = none
  promoEnd: number; // ms epoch, 0 = no promo countdown
  whatsapp: string; // admin number, international digits (62…)
  paymentInfo: string; // bank / QRIS instructions shown on the buy page
  maxDevices: number;
  packages: number[]; // month options
}

export const DEFAULT_CONFIG: SalesConfig = {
  price: 500_000,
  normalPrice: 0,
  promoEnd: 0,
  whatsapp: '',
  paymentInfo: '',
  maxDevices: 2,
  packages: [1, 3, 6, 12],
};

// ---------- small helpers ----------

/** No 0/O or 1/I, so codes survive being read out or retyped. 32 symbols, so random bytes map without bias. */
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function randomString(n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 32];
  return s;
}

export function newCode(): string {
  const r = randomString(12);
  return `DTY-${r.slice(0, 4)}-${r.slice(4, 8)}-${r.slice(8)}`;
}

export const newOrderId = () => randomString(6);

/** Accept codes typed with or without dashes, spaces, lower case or the DTY prefix. */
export function normalizeCode(input: string): string | null {
  const s = String(input ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
  const body = s.startsWith('DTY') ? s.slice(3) : s;
  if (body.length !== 12 || [...body].some((c) => !ALPHABET.includes(c))) return null;
  return `DTY-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
}

/** Indonesian phone numbers to wa.me format: 0812… / +62 812… / 812… → 62812… */
export function normalizePhone(input: string): string {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.startsWith('0')) d = `62${d.slice(1)}`;
  else if (d.startsWith('8')) d = `62${d}`;
  return d.length >= 9 && d.length <= 15 ? d : '';
}

export const maskCode = (code: string) => `DTY-****-****-${code.slice(-4)}`;

export function codeStatus(r: AccessCode, now: number): CodeStatus {
  return r.revoked ? 'dicabut' : r.exp <= now ? 'habis' : 'aktif';
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- sessions & cookies ----------

export interface Session {
  c: string; // code
  d: string; // device id
  exp: number; // session expiry (short)
  until: number; // code expiry at issue time
}

export async function signSession(s: Session, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(s)));
  return `${body}.${await hmac(secret, body)}`;
}

/** Verify the signature; returns the payload even when its `exp` has passed. */
export async function readSession(value: string | undefined, secret: string): Promise<Session | null> {
  if (!value) return null;
  const [body, sig] = value.split('.');
  if (!body || !sig || !safeEqual(sig, await hmac(secret, body))) return null;
  try {
    const s = JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
    return typeof s?.c === 'string' && typeof s?.d === 'string' && typeof s?.exp === 'number' ? (s as Session) : null;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function cookie(name: string, value: string, maxAgeMs: number, secure: boolean): string {
  return [
    `${name}=${value}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`,
    'SameSite=Lax',
    'HttpOnly',
    secure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function noStoreHeaders(cookies: string[], extra: Record<string, string> = {}): Headers {
  const h = new Headers({ 'Cache-Control': 'no-store', ...extra });
  for (const c of cookies) h.append('Set-Cookie', c);
  return h;
}

const json = (body: unknown, status = 200, cookies: string[] = []) =>
  new Response(JSON.stringify(body), { status, headers: noStoreHeaders(cookies, { 'Content-Type': 'application/json; charset=utf-8' }) });

const redirect = (location: string, cookies: string[] = []) =>
  new Response(null, { status: 302, headers: noStoreHeaders(cookies, { Location: location }) });

/** Only same-site relative paths, to avoid an open redirect through ?next=. */
const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');

const isDocumentRequest = (req: Request) =>
  req.method === 'GET' &&
  (req.headers.get('sec-fetch-dest') === 'document' || (req.headers.get('accept') ?? '').includes('text/html'));

const notConfigured = () =>
  new Response(
    'Server belum dikonfigurasi: isi environment variable SESSION_SECRET dan ADMIN_PASSWORD, lalu deploy ulang.',
    { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } },
  );

// ---------- edge gate ----------

export type GateResult = { pass: true } | { pass: false; response: Response };

/** Runs in front of every protected file. Stateless: signature + short session expiry. */
export async function gate(req: Request, env: Env): Promise<GateResult> {
  if (!env.sessionSecret) return { pass: false, response: notConfigured() };
  const now = (env.now ?? Date.now)();
  const url = new URL(req.url);
  const s = await readSession(parseCookies(req.headers.get('cookie'))[SESSION_COOKIE], env.sessionSecret);
  if (s && s.exp > now) return { pass: true };
  if (!isDocumentRequest(req)) {
    return { pass: false, response: new Response('Akses diperlukan', { status: 401, headers: noStoreHeaders([]) }) };
  }
  if (s) return { pass: false, response: redirect(`/api/refresh?next=${encodeURIComponent(url.pathname + url.search)}`) };
  return { pass: false, response: redirect(BUY_PATH) };
}

// ---------- store access ----------

export async function getConfig(store: Store): Promise<SalesConfig> {
  return { ...DEFAULT_CONFIG, ...((await store.get<Partial<SalesConfig>>('config')) ?? {}) };
}

async function listValues<T>(store: Store, prefix: string): Promise<T[]> {
  const keys = await store.list(prefix);
  const values: (T | null)[] = await Promise.all(keys.map((k) => store.get<T>(k)));
  return values.filter((v): v is T => v !== null);
}

const codeKey = (code: string) => `code/${code}`;
const orderKey = (id: string) => `order/${id}`;

type Check = { ok: true; record: AccessCode } | { ok: false; reason: 'invalid' | 'expired' | 'revoked' | 'device' };

/** Is this session still backed by a live code on a registered device? */
async function checkSession(s: Session, store: Store, now: number): Promise<Check> {
  const record = await store.get<AccessCode>(codeKey(s.c));
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.revoked) return { ok: false, reason: 'revoked' };
  if (record.exp <= now) return { ok: false, reason: 'expired' };
  if (!record.devices.includes(s.d)) return { ok: false, reason: 'device' };
  return { ok: true, record };
}

async function sessionCookieFor(record: AccessCode, device: string, env: Env, now: number, secure: boolean): Promise<string> {
  const session: Session = { c: record.code, d: device, exp: Math.min(now + SESSION_MS, record.exp), until: record.exp };
  return cookie(SESSION_COOKIE, await signSession(session, env.sessionSecret), record.exp - now, secure);
}

const clearSession = (secure: boolean) => cookie(SESSION_COOKIE, '', 0, secure);

function readMonths(v: unknown, allowed?: number[]): number | null {
  const m = Math.round(Number(v));
  if (!Number.isFinite(m) || m < 1 || m > 36) return null;
  return allowed && !allowed.includes(m) ? null : m;
}

const text = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

// ---------- API ----------

/** Handles every /api/* request. */
export async function handleApi(req: Request, env: Env, store: Store): Promise<Response> {
  if (!env.sessionSecret || !env.adminPassword) return notConfigured();
  const now = (env.now ?? Date.now)();
  const url = new URL(req.url);
  const secure = url.protocol === 'https:';
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  const method = req.method.toUpperCase();
  const body = async () => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const cookies = parseCookies(req.headers.get('cookie'));

  if (path.startsWith('admin')) return handleAdmin(req, env, store, path.replace(/^admin\/?/, ''), now);

  if (path === 'config' && method === 'GET') {
    const c = await getConfig(store);
    return json({ ...c, serverTime: now });
  }

  if (path === 'order' && method === 'POST') {
    const b = await body();
    const c = await getConfig(store);
    const name = text(b.name, 60);
    const contact = normalizePhone(String(b.contact ?? ''));
    const months = readMonths(b.months, c.packages);
    if (name.length < 2) return json({ error: 'name', message: 'Isi nama Anda.' }, 400);
    if (!contact) return json({ error: 'contact', message: 'Nomor WhatsApp tidak valid.' }, 400);
    if (!months) return json({ error: 'months', message: 'Pilih paket yang tersedia.' }, 400);
    const open = (await listValues<Order>(store, 'order/')).filter((o) => o.status === 'baru');
    if (open.length >= MAX_OPEN_ORDERS) return json({ error: 'busy', message: 'Pesanan sedang penuh, hubungi admin via WhatsApp.' }, 429);
    const order: Order = { id: newOrderId(), name, contact, months, total: months * c.price, createdAt: now, status: 'baru' };
    await store.set(orderKey(order.id), order);
    return json({ id: order.id, total: order.total });
  }

  if (path === 'login' && method === 'POST') {
    const code = normalizeCode(String((await body()).code ?? ''));
    if (!code) return json({ error: 'invalid', message: 'Format kode tidak dikenal. Contoh: DTY-AB12-CD34-EF56.' }, 400);
    const record = await store.get<AccessCode>(codeKey(code));
    if (!record) return json({ error: 'invalid', message: 'Kode akses tidak ditemukan.' }, 404);
    const status = codeStatus(record, now);
    if (status === 'dicabut') return json({ error: 'revoked', message: 'Kode ini sudah dinonaktifkan. Hubungi admin.' }, 403);
    if (status === 'habis') return json({ error: 'expired', message: 'Masa akses kode ini sudah habis. Perpanjang via WhatsApp.' }, 403);
    const c = await getConfig(store);
    const device = /^[0-9A-Z]{16}$/.test(cookies[DEVICE_COOKIE] ?? '') ? cookies[DEVICE_COOKIE] : randomString(16);
    if (!record.devices.includes(device)) {
      if (record.devices.length >= c.maxDevices) {
        return json(
          { error: 'device_limit', message: `Kode ini sudah dipakai di ${c.maxDevices} perangkat. Keluar dari perangkat lama atau minta admin mereset perangkat.` },
          403,
        );
      }
      record.devices.push(device);
      record.log.push({ at: now, action: 'perangkat baru' });
      await store.set(codeKey(code), record);
    }
    return json({ ok: true, name: record.name, exp: record.exp }, 200, [
      await sessionCookieFor(record, device, env, now, secure),
      cookie(DEVICE_COOKIE, device, DEVICE_COOKIE_DAYS * DAY_MS, secure),
    ]);
  }

  if (path === 'logout' && method === 'POST') {
    const s = await readSession(cookies[SESSION_COOKIE], env.sessionSecret);
    if (s) {
      // Free the device slot so the buyer can move to another device.
      const record = await store.get<AccessCode>(codeKey(s.c));
      if (record?.devices.includes(s.d)) {
        record.devices = record.devices.filter((d) => d !== s.d);
        record.log.push({ at: now, action: 'keluar' });
        await store.set(codeKey(s.c), record);
      }
    }
    return json({ ok: true }, 200, [clearSession(secure)]);
  }

  if ((path === 'me' && method === 'GET') || (path === 'refresh' && method === 'GET')) {
    const s = await readSession(cookies[SESSION_COOKIE], env.sessionSecret);
    const check: Check = s ? await checkSession(s, store, now) : { ok: false, reason: 'invalid' };
    if (path === 'refresh') {
      if (!check.ok) return redirect(`${BUY_PATH}?alasan=${check.reason}`, [clearSession(secure)]);
      return redirect(safeNext(url.searchParams.get('next')), [await sessionCookieFor(check.record, s!.d, env, now, secure)]);
    }
    if (!check.ok) return json({ error: check.reason }, 401, s ? [clearSession(secure)] : []);
    const c = await getConfig(store);
    const r = check.record;
    return json(
      { name: r.name, exp: r.exp, code: maskCode(r.code), devicesUsed: r.devices.length, maxDevices: c.maxDevices, serverTime: now },
      200,
      [await sessionCookieFor(r, s!.d, env, now, secure)],
    );
  }

  return json({ error: 'not_found' }, 404);
}

async function handleAdmin(req: Request, env: Env, store: Store, path: string, now: number): Promise<Response> {
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  // Compare digests so the comparison takes the same time whatever the input length.
  const ok = given && safeEqual(await hmac(env.sessionSecret, given), await hmac(env.sessionSecret, env.adminPassword));
  if (!ok) return json({ error: 'unauthorized', message: 'Password admin salah.' }, 401);

  const method = req.method.toUpperCase();
  const body = async () => ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const [section, id, action] = path.split('/').map(decodeURIComponent);

  if (section === 'config') {
    if (method === 'GET') return json(await getConfig(store));
    if (method === 'PUT') {
      const b = await body();
      const cur = await getConfig(store);
      const next: SalesConfig = {
        price: b.price !== undefined ? Math.max(0, Math.round(Number(b.price) || 0)) : cur.price,
        normalPrice: b.normalPrice !== undefined ? Math.max(0, Math.round(Number(b.normalPrice) || 0)) : cur.normalPrice,
        promoEnd: b.promoEnd !== undefined ? Math.max(0, Math.round(Number(b.promoEnd) || 0)) : cur.promoEnd,
        whatsapp: b.whatsapp !== undefined ? normalizePhone(String(b.whatsapp)) : cur.whatsapp,
        paymentInfo: b.paymentInfo !== undefined ? text(b.paymentInfo, 1500) : cur.paymentInfo,
        maxDevices: b.maxDevices !== undefined ? Math.min(10, Math.max(1, Math.round(Number(b.maxDevices) || 1))) : cur.maxDevices,
        packages: Array.isArray(b.packages)
          ? [...new Set(b.packages.map((m) => readMonths(m)).filter((m): m is number => m !== null))].sort((x, y) => x - y)
          : cur.packages,
      };
      if (!next.packages.length) next.packages = DEFAULT_CONFIG.packages;
      await store.set('config', next);
      return json(next);
    }
  }

  if (section === 'orders') {
    if (!id && method === 'GET') {
      const orders = await listValues<Order>(store, 'order/');
      return json(orders.sort((a, b) => b.createdAt - a.createdAt));
    }
    const order = id ? await store.get<Order>(orderKey(id)) : null;
    if (!order) return json({ error: 'not_found' }, 404);
    if (method === 'DELETE' && !action) {
      await store.delete(orderKey(id));
      return json({ ok: true });
    }
    if (method === 'POST' && action === 'status') {
      const status = String((await body()).status) as OrderStatus;
      if (!['baru', 'selesai', 'batal'].includes(status)) return json({ error: 'status' }, 400);
      order.status = status;
      await store.set(orderKey(id), order);
      return json(order);
    }
  }

  if (section === 'codes') {
    if (!id && method === 'GET') {
      const codes = await listValues<AccessCode>(store, 'code/');
      return json(codes.sort((a, b) => b.createdAt - a.createdAt).map((c) => ({ ...c, status: codeStatus(c, now) })));
    }
    if (!id && method === 'POST') {
      const b = await body();
      const name = text(b.name, 60);
      const months = readMonths(b.months);
      if (name.length < 2) return json({ error: 'name', message: 'Isi nama pembeli.' }, 400);
      if (!months) return json({ error: 'months', message: 'Jumlah bulan 1–36.' }, 400);
      let code = newCode();
      while (await store.get(codeKey(code))) code = newCode();
      const orderId = text(b.orderId, 12) || undefined;
      const record: AccessCode = {
        code,
        name,
        contact: normalizePhone(String(b.contact ?? '')),
        note: text(b.note, 200),
        months,
        createdAt: now,
        exp: now + months * MONTH_MS,
        revoked: false,
        devices: [],
        orderId,
        log: [{ at: now, action: 'dibuat', months }],
      };
      await store.set(codeKey(code), record);
      if (orderId) {
        const order = await store.get<Order>(orderKey(orderId));
        if (order) await store.set(orderKey(orderId), { ...order, status: 'selesai', code });
      }
      return json({ ...record, status: codeStatus(record, now) }, 201);
    }
    const code = id ? normalizeCode(id) : null;
    const record = code ? await store.get<AccessCode>(codeKey(code)) : null;
    if (!code || !record) return json({ error: 'not_found' }, 404);
    if (method === 'DELETE' && !action) {
      await store.delete(codeKey(code));
      return json({ ok: true });
    }
    if (method === 'POST') {
      if (action === 'extend') {
        const months = readMonths((await body()).months);
        if (!months) return json({ error: 'months', message: 'Jumlah bulan 1–36.' }, 400);
        record.exp = Math.max(record.exp, now) + months * MONTH_MS;
        record.months += months;
        record.log.push({ at: now, action: 'diperpanjang', months });
      } else if (action === 'revoke') {
        record.revoked = true;
        record.log.push({ at: now, action: 'dicabut' });
      } else if (action === 'restore') {
        record.revoked = false;
        record.log.push({ at: now, action: 'dipulihkan' });
      } else if (action === 'reset-devices') {
        record.devices = [];
        record.log.push({ at: now, action: 'reset perangkat' });
      } else {
        return json({ error: 'not_found' }, 404);
      }
      await store.set(codeKey(code), record);
      return json({ ...record, status: codeStatus(record, now) });
    }
  }

  return json({ error: 'not_found' }, 404);
}

/** In-memory Store for tests and the local server. */
export function memoryStore(seed: Record<string, unknown> = {}): Store & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(seed));
  const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  return {
    data,
    get: async <T>(k: string) => (data.has(k) ? clone(data.get(k) as T) : null),
    set: async (k, v) => {
      data.set(k, clone(v));
    },
    delete: async (k) => {
      data.delete(k);
    },
    list: async (prefix) => [...data.keys()].filter((k) => k.startsWith(prefix)),
  };
}
