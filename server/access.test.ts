import { describe, expect, it } from 'vitest';
import {
  DEVICE_COOKIE,
  MONTH_MS,
  SESSION_COOKIE,
  SESSION_MS,
  gate,
  handleApi,
  memoryStore,
  newCode,
  normalizeCode,
  normalizePhone,
  parseCookies,
  readSession,
  signSession,
  type AccessCode,
  type Env,
} from './access.ts';

const T0 = Date.UTC(2026, 9, 4, 9);

function setup(now = T0) {
  const clock = { now };
  const env: Env = { sessionSecret: 'test-secret-0123456789', adminPassword: 'rahasia-admin', now: () => clock.now };
  const store = memoryStore();
  const jar: Record<string, string> = {};
  const call = async (path: string, init: RequestInit & { admin?: boolean } = {}) => {
    const headers = new Headers(init.headers);
    if (init.admin) headers.set('authorization', `Bearer ${env.adminPassword}`);
    const cookieHeader = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    if (cookieHeader) headers.set('cookie', cookieHeader);
    if (init.body) headers.set('content-type', 'application/json');
    const res = await handleApi(new Request(`https://dty.test${path}`, { ...init, headers }), env, store);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=');
      if (/Max-Age=0\b/.test(c)) delete jar[k];
      else jar[k] = v;
    }
    return res;
  };
  const page = (path: string, accept = 'text/html') => {
    const cookieHeader = Object.entries(jar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    return gate(new Request(`https://dty.test${path}`, { headers: { accept, cookie: cookieHeader } }), env);
  };
  const createCode = async (months = 1, name = 'Budi') => {
    const res = await call('/api/admin/codes', { method: 'POST', admin: true, body: JSON.stringify({ name, contact: '0812 3456 7890', months }) });
    return (await res.json()) as AccessCode;
  };
  return { clock, env, store, jar, call, page, createCode };
}

describe('codes', () => {
  it('generates readable codes and normalises user input', () => {
    const c = newCode();
    expect(c).toMatch(/^DTY-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/);
    expect(normalizeCode(c.toLowerCase().replace(/-/g, ' '))).toBe(c);
    expect(normalizeCode(c.slice(4))).toBe(c);
    expect(normalizeCode('DTY-0000-0000-0000')).toBeNull(); // 0 is not in the alphabet
    expect(normalizeCode('nope')).toBeNull();
  });

  it('normalises Indonesian phone numbers for wa.me', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('6281234567890');
    expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890');
    expect(normalizePhone('812345678')).toBe('62812345678');
    expect(normalizePhone('12')).toBe('');
  });

  it('signs sessions and rejects tampering', async () => {
    const v = await signSession({ c: 'DTY-AAAA-BBBB-CCCC', d: 'D'.repeat(16), exp: 1, until: 2 }, 'k');
    expect(await readSession(v, 'k')).toMatchObject({ c: 'DTY-AAAA-BBBB-CCCC', exp: 1 });
    expect(await readSession(v, 'other')).toBeNull();
    const [body, sig] = v.split('.');
    expect(await readSession(`${body}x.${sig}`, 'k')).toBeNull();
    expect(parseCookies('a=1; b = 2;c=3=4')).toEqual({ a: '1', b: '2', c: '3=4' });
  });
});

describe('access flow', () => {
  it('locks the app until a code is activated, then lets it through', async () => {
    const t = setup();
    let g = await t.page('/');
    expect(g.pass).toBe(false);
    if (!g.pass) {
      expect(g.response.status).toBe(302);
      expect(g.response.headers.get('location')).toBe('/beli/');
    }
    g = await t.page('/assets/index.js', '*/*');
    expect(!g.pass && g.response.status).toBe(401);

    const code = await t.createCode(1);
    expect(code.exp).toBe(T0 + MONTH_MS);
    const res = await t.call('/api/login', { method: 'POST', body: JSON.stringify({ code: code.code.toLowerCase() }) });
    expect(res.status).toBe(200);
    expect(t.jar[SESSION_COOKIE]).toBeTruthy();
    expect(t.jar[DEVICE_COOKIE]).toMatch(/^[0-9A-Z]{16}$/);
    expect((await t.page('/')).pass).toBe(true);
    expect((await t.page('/assets/index.js', '*/*')).pass).toBe(true);

    const me = await (await t.call('/api/me')).json();
    expect(me).toMatchObject({ name: 'Budi', exp: T0 + MONTH_MS, devicesUsed: 1, maxDevices: 2 });
    expect(me.code).toMatch(/^DTY-\*{4}-\*{4}-/);
  });

  it('refreshes short sessions through /api/refresh and picks up extensions', async () => {
    const t = setup();
    const code = await t.createCode(1);
    await t.call('/api/login', { method: 'POST', body: JSON.stringify({ code: code.code }) });
    t.clock.now += SESSION_MS + 1000;
    const g = await t.page('/#/coins');
    expect(!g.pass && g.response.headers.get('location')).toMatch(/^\/api\/refresh\?next=/);
    await t.call(`/api/admin/codes/${code.code}/extend`, { method: 'POST', admin: true, body: JSON.stringify({ months: 2 }) });
    const r = await t.call('/api/refresh?next=%2F');
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toBe('/');
    expect((await t.page('/')).pass).toBe(true);
    expect((await (await t.call('/api/me')).json()).exp).toBe(T0 + 3 * MONTH_MS);
    // open redirects are refused
    expect((await t.call('/api/refresh?next=//evil.example')).headers.get('location')).toBe('/');
  });

  it('ends access on revocation and on expiry', async () => {
    const t = setup();
    const code = await t.createCode(1);
    await t.call('/api/login', { method: 'POST', body: JSON.stringify({ code: code.code }) });
    await t.call(`/api/admin/codes/${code.code}/revoke`, { method: 'POST', admin: true });
    const me = await t.call('/api/me');
    expect(me.status).toBe(401);
    expect((await me.json()).error).toBe('revoked');
    expect(t.jar[SESSION_COOKIE]).toBeUndefined();
    const again = await t.call('/api/login', { method: 'POST', body: JSON.stringify({ code: code.code }) });
    expect((await again.json()).error).toBe('revoked');

    await t.call(`/api/admin/codes/${code.code}/restore`, { method: 'POST', admin: true });
    t.clock.now += MONTH_MS + 1;
    const late = await t.call('/api/login', { method: 'POST', body: JSON.stringify({ code: code.code }) });
    expect(late.status).toBe(403);
    expect((await late.json()).error).toBe('expired');
  });

  it('limits devices, frees a slot on logout and on admin reset', async () => {
    const t = setup();
    const code = await t.createCode(1);
    const login = async () => {
      delete t.jar[SESSION_COOKIE];
      delete t.jar[DEVICE_COOKIE]; // a new browser
      return t.call('/api/login', { method: 'POST', body: JSON.stringify({ code: code.code }) });
    };
    expect((await login()).status).toBe(200);
    expect((await login()).status).toBe(200);
    const third = await login();
    expect(third.status).toBe(403);
    expect((await third.json()).error).toBe('device_limit');

    // The admin clears the devices; the blocked browser can now activate, and logging out frees its slot.
    await t.call(`/api/admin/codes/${code.code}/reset-devices`, { method: 'POST', admin: true });
    expect((await login()).status).toBe(200);
    expect((await t.call('/api/logout', { method: 'POST' })).status).toBe(200);
    const rec = await t.store.get<AccessCode>(`code/${code.code}`);
    expect(rec?.devices).toEqual([]);
  });

  it('records orders and links them to the code made for them', async () => {
    const t = setup();
    const bad = await t.call('/api/order', { method: 'POST', body: JSON.stringify({ name: 'A', contact: '0812', months: 2 }) });
    expect(bad.status).toBe(400);
    const res = await t.call('/api/order', { method: 'POST', body: JSON.stringify({ name: 'Siti', contact: '081234567890', months: 3 }) });
    const { id, total } = await res.json();
    expect(total).toBe(1_500_000);
    const orders = await (await t.call('/api/admin/orders', { admin: true })).json();
    expect(orders[0]).toMatchObject({ id, name: 'Siti', contact: '6281234567890', status: 'baru' });
    const made = await t.call('/api/admin/codes', { method: 'POST', admin: true, body: JSON.stringify({ name: 'Siti', months: 3, orderId: id }) });
    const code = (await made.json()).code;
    const after = await (await t.call('/api/admin/orders', { admin: true })).json();
    expect(after[0]).toMatchObject({ status: 'selesai', code });
  });

  it('protects admin routes and validates config', async () => {
    const t = setup();
    expect((await t.call('/api/admin/codes')).status).toBe(401);
    expect((await t.call('/api/admin/codes', { headers: { authorization: 'Bearer salah' } })).status).toBe(401);
    const put = await t.call('/api/admin/config', {
      method: 'PUT',
      admin: true,
      body: JSON.stringify({ price: '450000', promoEnd: T0 + 86_400_000, whatsapp: '0812-1111-2222', maxDevices: 99, packages: [12, 1, 'x', 1] }),
    });
    expect(await put.json()).toMatchObject({ price: 450_000, whatsapp: '6281211112222', maxDevices: 10, packages: [1, 12] });
    const pub = await (await t.call('/api/config')).json();
    expect(pub).toMatchObject({ price: 450_000, serverTime: T0 });
  });

  it('refuses to run without secrets', async () => {
    const res = await handleApi(new Request('https://dty.test/api/me'), { sessionSecret: '', adminPassword: '' }, memoryStore());
    expect(res.status).toBe(503);
    const g = await gate(new Request('https://dty.test/'), { sessionSecret: '', adminPassword: '' });
    expect(!g.pass && g.response.status).toBe(503);
  });
});
