import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanPath, createHandler, fileStore, loadEnv } from './node.mjs';

const env = { sessionSecret: 's'.repeat(40), adminPassword: 'rahasia-admin' };
let dir;
let server;
let base;
let store;

const get = (path, headers = {}) => fetch(base + path, { headers, redirect: 'manual' });
const html = { accept: 'text/html' };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dty-node-'));
  const dist = join(dir, 'dist');
  await mkdir(join(dist, 'assets'), { recursive: true });
  await mkdir(join(dist, 'beli', 'assets'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<p>terminal</p>');
  await writeFile(join(dist, 'assets', 'app.js'), 'secret()');
  await writeFile(join(dist, 'beli', 'index.html'), '<p>beli</p>');
  await writeFile(join(dist, 'beli', 'assets', 'buy.js'), 'buy()');
  await writeFile(join(dir, '.env'), 'SESSION_SECRET=x');
  store = await fileStore(join(dir, '.data'));
  server = createServer(createHandler({ dist, env, store }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  server.close();
  await rm(dir, { recursive: true, force: true });
});

describe('node server', () => {
  it('refuses weak or missing secrets in production only', () => {
    expect(() => loadEnv({ NODE_ENV: 'production' })).toThrow(/SESSION_SECRET/);
    expect(() => loadEnv({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), ADMIN_PASSWORD: 'short' })).toThrow(/ADMIN_PASSWORD/);
    expect(loadEnv({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), ADMIN_PASSWORD: 'cukup-panjang' }).adminPassword).toBe('cukup-panjang');
    expect(loadEnv({}).adminPassword).toBe('admin');
  });

  it('normalizes paths before the gate sees them', () => {
    expect(cleanPath('/beli/..%2fassets/app.js')).toBe('/assets/app.js');
    expect(cleanPath('/beli/%2e%2e/%2e%2e/.env')).toBe('/.env');
    expect(cleanPath('/a\\b')).toBeNull();
    expect(cleanPath('/%E0%A4%A')).toBeNull();
  });

  it('serves public pages and locks the terminal', async () => {
    const buy = await get('/beli/');
    expect(buy.status).toBe(200);
    expect(await buy.text()).toContain('beli');
    expect(buy.headers.get('cache-control')).toBe('no-cache');
    expect((await get('/beli/assets/buy.js')).headers.get('cache-control')).toContain('immutable');
    expect((await get('/beli')).status).toBe(301);

    const home = await get('/', html);
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe('/beli/');
    expect((await get('/assets/app.js')).status).toBe(401);
  });

  it('does not let a public prefix unlock protected or outside files', async () => {
    for (const path of ['/beli/..%2fassets/app.js', '/beli/%2e%2e/assets/app.js', '/demo/..%2f..%2f.env', '/beli/..%2f..%2f.env']) {
      const res = await get(path);
      expect(res.status, path).not.toBe(200);
      expect(await res.text(), path).not.toMatch(/secret|SESSION_SECRET/);
    }
  });

  it('runs the whole buy → activate → open flow and marks cookies Secure behind HTTPS', async () => {
    const created = await fetch(`${base}/api/admin/codes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.adminPassword}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Budi', contact: '08123456789', months: 1 }),
    });
    expect(created.status).toBe(201);
    const { code } = await created.json();

    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-Proto': 'https' },
      body: JSON.stringify({ code }),
    });
    expect(login.status).toBe(200);
    const cookies = login.headers.getSetCookie();
    expect(cookies.every((c) => c.includes('Secure'))).toBe(true);

    const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    const terminal = await get('/', { ...html, cookie });
    expect(terminal.status).toBe(200);
    expect(terminal.headers.get('cache-control')).toBe('private, no-store');
    expect(await (await get('/assets/app.js', { cookie })).text()).toBe('secret()');

    await store.flush();
    const saved = JSON.parse(await readFile(join(dir, '.data', 'access.json'), 'utf8'));
    expect(Object.keys(saved).some((k) => k.startsWith('code/'))).toBe(true);
  });

  it('rejects oversized bodies and unknown methods', async () => {
    const big = await fetch(`${base}/api/order`, { method: 'POST', body: 'x'.repeat(70_000) });
    expect(big.status).toBe(413);
    expect((await fetch(`${base}/beli/`, { method: 'DELETE' })).status).toBe(405);
  });
});
