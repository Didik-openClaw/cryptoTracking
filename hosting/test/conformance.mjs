// End-to-end checks of the paid-access flow over HTTP, for any implementation
// (PHP on shared hosting, the Node server): order → admin code → activate →
// open the terminal → device limit → revoke → logout.
//
//   BASE=http://127.0.0.1:8080 ADMIN=… node hosting/test/conformance.mjs
// The admin password must already be set; the store may be empty or not.

class Jar {
  cookies = new Map();
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  take(res) {
    for (const c of res.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const i = kv.indexOf('=');
      const name = kv.slice(0, i).trim();
      const value = kv.slice(i + 1).trim();
      const maxAge = attrs.map((a) => a.trim()).find((a) => /^max-age=/i.test(a));
      if (value === '' || maxAge === 'Max-Age=0') this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

export async function runConformance(base, admin, log = () => {}) {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const call = async (path, { method = 'GET', body, jar, adminKey, headers = {}, html } = {}) => {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (jar) h.Cookie = jar.header();
    if (adminKey !== undefined) h.Authorization = `Bearer ${adminKey}`;
    if (html) h.Accept = 'text/html';
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    jar?.take(res);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not json */
    }
    return { res, status: res.status, text, json, location: res.headers.get('location') };
  };

  // Public pages and the locked terminal.
  let r = await call('/', { html: true });
  check('terminal redirects to the buy page without a session', r.status === 302 && /\/beli\/$/.test(r.location ?? ''), `${r.status} ${r.location}`);
  r = await call('/assets/');
  check('terminal files answer 401/302 without a session', [302, 401].includes(r.status), String(r.status));
  r = await call('/beli/', { html: true });
  check('buy page is public', r.status === 200 && r.text.includes('<div id="root">'), String(r.status));
  r = await call('/api/config');
  check('config is public and has the price', r.status === 200 && r.json?.price > 0 && Array.isArray(r.json?.packages), String(r.status));

  // Admin auth.
  r = await call('/api/admin/codes', { adminKey: 'wrong-password' });
  check('wrong admin password is refused', r.status === 401 && r.json?.error === 'unauthorized', String(r.status));
  r = await call('/api/admin/config', { method: 'PUT', adminKey: admin, body: { maxDevices: 2, packages: [1, 3, 6, 12], whatsapp: '0812-3456-789' } });
  check('admin can save sales settings', r.status === 200 && r.json?.whatsapp === '628123456789' && r.json?.maxDevices === 2, JSON.stringify(r.json));

  // Order → code.
  r = await call('/api/order', { method: 'POST', body: { name: 'Budi Tester', contact: '081234567890', months: 3 } });
  check('buyer can place an order', r.status === 200 && typeof r.json?.id === 'string' && r.json.total === 3 * 500000, JSON.stringify(r.json));
  const orderId = r.json?.id;
  r = await call('/api/order', { method: 'POST', body: { name: 'X', contact: '1', months: 2 } });
  check('invalid orders are refused', r.status === 400, String(r.status));
  r = await call('/api/admin/codes', { method: 'POST', adminKey: admin, body: { name: 'Budi Tester', contact: '081234567890', months: 1, orderId } });
  check('admin creates a code from the order', r.status === 201 && /^DTY-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(r.json?.code ?? ''), JSON.stringify(r.json));
  const code = r.json?.code;
  r = await call('/api/admin/orders', { adminKey: admin });
  const order = r.json?.find?.((o) => o.id === orderId);
  check('the order is marked done with the code', order?.status === 'selesai' && order?.code === code, JSON.stringify(order));

  // Activate on device A.
  const a = new Jar();
  r = await call('/api/login', { method: 'POST', jar: a, body: { code: code.toLowerCase().replace(/-/g, ' ') } });
  check('code activates (any spelling)', r.status === 200 && a.cookies.has('dty_s') && a.cookies.has('dty_d'), `${r.status} ${r.text.slice(0, 120)}`);
  r = await call('/', { jar: a, html: true });
  check('terminal opens with the session', r.status === 200 && r.text.includes('<div id="root">') && /no-store/.test(r.res.headers.get('cache-control') ?? ''), String(r.status));
  r = await call('/api/me', { jar: a });
  check('/api/me shows the remaining access', r.status === 200 && r.json?.code?.startsWith('DTY-****') && r.json?.devicesUsed === 1, JSON.stringify(r.json));
  r = await call('/api/refresh?next=%2F%23%2Fcoin%2FBTC', { jar: a });
  check('refresh renews the session and goes back', r.status === 302 && r.location === '/#/coin/BTC', `${r.status} ${r.location}`);
  r = await call('/api/refresh?next=%2F%2Fevil.example', { jar: a });
  check('refresh refuses open redirects', r.status === 302 && r.location === '/', `${r.location}`);

  // Device limit.
  const b = new Jar();
  const c = new Jar();
  r = await call('/api/login', { method: 'POST', jar: b, body: { code } });
  check('second device is allowed', r.status === 200, String(r.status));
  r = await call('/api/login', { method: 'POST', jar: c, body: { code } });
  check('third device is refused', r.status === 403 && r.json?.error === 'device_limit', String(r.status));

  // Extend, revoke, restore.
  r = await call(`/api/admin/codes/${code}/extend`, { method: 'POST', adminKey: admin, body: { months: 1 } });
  check('admin extends by a month', r.status === 200 && r.json?.months === 2, JSON.stringify(r.json?.months));
  r = await call(`/api/admin/codes/${code}/revoke`, { method: 'POST', adminKey: admin });
  check('admin revokes', r.status === 200 && r.json?.status === 'dicabut', String(r.json?.status));
  r = await call('/api/me', { jar: a });
  check('revoked code fails /api/me', r.status === 401 && r.json?.error === 'revoked', `${r.status} ${r.text}`);
  r = await call('/api/refresh?next=%2F', { jar: b });
  check('revoked code: refresh sends to the buy page', r.status === 302 && r.location === '/beli/?alasan=revoked', `${r.location}`);
  r = await call(`/api/admin/codes/${code}/restore`, { method: 'POST', adminKey: admin });
  check('admin restores', r.status === 200 && r.json?.status === 'aktif', String(r.json?.status));

  // The failed checks above cleared A's session; its device is still registered, so it logs back in.
  r = await call('/api/login', { method: 'POST', jar: a, body: { code } });
  check('a registered device logs back in after restore', r.status === 200, String(r.status));

  // Logout frees the slot.
  r = await call('/api/logout', { method: 'POST', jar: a });
  check('logout clears the session', r.status === 200 && !a.cookies.has('dty_s'), String(r.status));
  r = await call('/api/login', { method: 'POST', jar: c, body: { code } });
  check('freed slot can be used by another device', r.status === 200, String(r.status));
  r = await call(`/api/admin/codes/${code}/reset-devices`, { method: 'POST', adminKey: admin });
  check('admin resets devices', r.status === 200 && r.json?.devices?.length === 0, JSON.stringify(r.json?.devices));

  // Tampered cookie.
  const t = new Jar();
  t.cookies.set('dty_s', 'eyJjIjoiRFRZIn0.AAAA');
  r = await call('/', { jar: t, html: true });
  check('forged session is refused', r.status === 302 && /\/beli\/$/.test(r.location ?? ''), `${r.status}`);

  r = await call(`/api/admin/codes/${code}`, { method: 'DELETE', adminKey: admin });
  check('admin deletes the code', r.status === 200, String(r.status));
  if (orderId) await call(`/api/admin/orders/${orderId}`, { method: 'DELETE', adminKey: admin });

  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.env.BASE ?? 'http://127.0.0.1:8080';
  const admin = process.env.ADMIN ?? '';
  const results = await runConformance(base, admin, console.log);
  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
