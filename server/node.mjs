#!/usr/bin/env node
// Node server for a VPS (or for trying the sell flow locally): serves dist/
// behind the same access gate and /api/* handler as the Netlify deploy
// (server/access.ts), with codes, orders and settings kept in one JSON file.
//
//   npm run build:pages && npm run serve:local             (local, admin password "admin")
//   NODE_ENV=production node server/node.mjs                (VPS, behind Nginx; see deploy/)
//
// Environment: SESSION_SECRET, ADMIN_PASSWORD (required in production),
// PORT (8888), HOST (127.0.0.1), DIST_DIR (./dist), DATA_DIR (./.data).
// Needs Node 22.18+ (loads the TypeScript module directly).
import { createServer } from 'node:http';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { extname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate, handleApi } from './access.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MAX_BODY = 64 * 1024;
const PUBLIC = [/^\/beli(\/|$)/, /^\/demo(\/|$)/, /^\/admin(\/|$)/, /^\/favicon\.svg$/];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Secrets from the environment; production refuses to start with missing or weak ones. */
export function loadEnv(vars = process.env) {
  const production = vars.NODE_ENV === 'production';
  const sessionSecret = vars.SESSION_SECRET || (production ? '' : 'local-dev-secret-change-me');
  const adminPassword = vars.ADMIN_PASSWORD || (production ? '' : 'admin');
  if (production) {
    const problems = [];
    if (sessionSecret.length < 32) problems.push('SESSION_SECRET minimal 32 karakter (buat dengan: openssl rand -hex 32)');
    if (adminPassword.length < 10) problems.push('ADMIN_PASSWORD minimal 10 karakter');
    if (problems.length) throw new Error(`Konfigurasi belum lengkap:\n  - ${problems.join('\n  - ')}`);
  }
  return { sessionSecret, adminPassword };
}

/** Store backed by one JSON file; writes are serialized and atomic (temp file + rename). */
export async function fileStore(dataDir) {
  const file = join(dataDir, 'access.json');
  let data = {};
  try {
    data = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw new Error(`Tidak bisa membaca ${file}: ${e.message}`);
  }
  let queue = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(data, null, 2);
    queue = queue.then(async () => {
      await mkdir(dataDir, { recursive: true, mode: 0o700 });
      await writeFile(`${file}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    return queue;
  };
  return {
    get: async (k) => (k in data ? structuredClone(data[k]) : null),
    set: async (k, v) => {
      data[k] = structuredClone(v);
      await persist();
    },
    delete: async (k) => {
      delete data[k];
      await persist();
    },
    list: async (prefix) => Object.keys(data).filter((k) => k.startsWith(prefix)),
    flush: () => queue,
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Decoded, normalized URL path, or null for anything that tries to step outside
 * the site. The gate and the file lookup both use this one value, so
 * "/beli/..%2fassets/x.js" is judged as the protected "/assets/x.js".
 */
export function cleanPath(pathname) {
  let p;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (p.includes('\0') || p.includes('\\')) return null;
  const clean = posix.normalize(p);
  return clean.startsWith('/') && !clean.startsWith('//') ? clean : null;
}

const isLoopback = (addr) => addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Permintaan terlalu besar');
    chunks.push(c);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

async function toRequest(req, port) {
  // Behind Nginx the browser speaks HTTPS; trust the proxy's header only from this machine,
  // so cookies get the Secure flag.
  const forwarded = isLoopback(req.socket.remoteAddress) ? req.headers['x-forwarded-proto'] : undefined;
  const proto = forwarded === 'https' ? 'https' : 'http';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`${proto}://${req.headers.host || `localhost:${port}`}${req.url}`, {
    method: req.method,
    headers,
    body: hasBody ? await readBody(req) : undefined,
  });
}

function securityHeaders(path) {
  const admin = /^\/admin(\/|$)/.test(path);
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': admin ? 'DENY' : 'SAMEORIGIN',
    'Referrer-Policy': admin ? 'no-referrer' : 'strict-origin-when-cross-origin',
    ...(admin && { 'X-Robots-Tag': 'noindex, nofollow' }),
  };
}

async function send(res, response, method, extra = {}) {
  const headers = { ...extra };
  response.headers.forEach((v, k) => {
    if (k !== 'set-cookie') headers[k] = v;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
}

function cacheControl(path, file, isPublic) {
  if (!isPublic) return file.endsWith('.html') ? 'private, no-store' : 'private, max-age=0, must-revalidate';
  if (/\/assets\//.test(path)) return 'public, max-age=31536000, immutable'; // content-hashed names
  return 'no-cache';
}

async function serveFile(res, dist, path, isPublic, method) {
  let file = resolve(dist, `.${path}`);
  if (file !== dist && !file.startsWith(dist + sep)) return send(res, new Response('Not found', { status: 404 }), method);
  try {
    if ((await stat(file)).isDirectory()) {
      // Directory URLs without a trailing slash, like Netlify does.
      if (!path.endsWith('/')) return send(res, new Response(null, { status: 301, headers: { Location: `${path}/` } }), method);
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cacheControl(path, file, isPublic),
      ...securityHeaders(path),
    });
    res.end(method === 'HEAD' ? undefined : body);
  } catch {
    send(res, new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }), method);
  }
}

/** Node request handler: /api/* → handleApi, protected files → gate, then static files from `dist`. */
export function createHandler({ dist, env, store, port = 0 }) {
  const root = resolve(dist);
  return async (req, res) => {
    const method = req.method ?? 'GET';
    try {
      const request = await toRequest(req, port);
      const path = cleanPath(new URL(request.url).pathname);
      if (path === null) throw new HttpError(400, 'Alamat tidak valid');
      if (path.startsWith('/api/')) return await send(res, await handleApi(request, env, store), method);
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Metode tidak didukung');
      const isPublic = PUBLIC.some((re) => re.test(path));
      if (!isPublic) {
        const verdict = await gate(request, env);
        if (!verdict.pass) return await send(res, verdict.response, method, securityHeaders(path));
      }
      await serveFile(res, root, path, isPublic, method);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (res.headersSent) return res.destroy();
      send(res, new Response(status === 500 ? 'Server error' : e.message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }), method);
    }
  };
}

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const port = Number(process.env.PORT || 8888);
  const host = process.env.HOST || '127.0.0.1';
  const dist = process.env.DIST_DIR || join(ROOT, 'dist');
  const store = await fileStore(process.env.DATA_DIR || join(ROOT, '.data'));
  const server = createServer(createHandler({ dist, env, store, port }));
  server.listen(port, host, () => {
    const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
    console.log(`DTY Crypto Terminal di ${base}`);
    console.log(`  halaman beli : ${base}/beli/`);
    console.log(`  admin        : ${base}/admin/  (password: ${process.env.ADMIN_PASSWORD ? 'dari ADMIN_PASSWORD' : 'admin'})`);
  });
  const stop = () => {
    server.close();
    store.flush().finally(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
