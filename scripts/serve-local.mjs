#!/usr/bin/env node
// Local stand-in for Netlify: serves dist/ behind the same access gate and
// /api/* handler the deployed site uses (server/access.ts), with data kept
// in .data/access.json. For trying the sell/activate flow before deploying.
//
//   npm run build:pages && npm run serve:local
//   ADMIN_PASSWORD=… SESSION_SECRET=… PORT=8888 npm run serve:local
//
// Needs Node 22.18+ (loads the TypeScript module directly).
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { gate, handleApi } from '../server/access.ts';

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const DATA_FILE = join(ROOT, '.data', 'access.json');
const PORT = Number(process.env.PORT || 8888);
const env = {
  sessionSecret: process.env.SESSION_SECRET || 'local-dev-secret-change-me',
  adminPassword: process.env.ADMIN_PASSWORD || 'admin',
};
const PUBLIC = [/^\/beli(\/|$)/, /^\/demo(\/|$)/, /^\/admin(\/|$)/, /^\/favicon\.svg$/];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// --- file-backed store (same interface as the Netlify Blobs adapter) ---
let data = {};
try {
  data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
} catch {
  /* first run */
}
const persist = async () => {
  await mkdir(join(ROOT, '.data'), { recursive: true });
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2));
};
const store = {
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
};

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  return new Request(`http://${req.headers.host ?? `localhost:${PORT}`}${req.url}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });
}

async function send(res, response) {
  const headers = {};
  response.headers.forEach((v, k) => {
    if (k !== 'set-cookie') headers[k] = v;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveFile(res, pathname) {
  let file = normalize(join(DIST, decodeURIComponent(pathname)));
  if (!file.startsWith(DIST)) return send(res, new Response('Forbidden', { status: 403 }));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    // Directory URLs without a trailing slash, like Netlify does.
    if (!pathname.endsWith('/') && !extname(pathname)) {
      try {
        if ((await stat(join(DIST, pathname))).isDirectory()) return send(res, new Response(null, { status: 301, headers: { Location: `${pathname}/` } }));
      } catch {
        /* fall through */
      }
    }
    send(res, new Response('Not found', { status: 404 }));
  }
}

createServer(async (req, res) => {
  try {
    const request = await toRequest(req);
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return send(res, await handleApi(request, env, store));
    if (!PUBLIC.some((re) => re.test(pathname))) {
      const verdict = await gate(request, env);
      if (!verdict.pass) return send(res, verdict.response);
    }
    await serveFile(res, pathname);
  } catch (e) {
    console.error(e);
    send(res, new Response('Server error', { status: 500 }));
  }
}).listen(PORT, () => {
  console.log(`DTY Crypto Terminal (lokal) di http://localhost:${PORT}`);
  console.log(`  halaman beli : http://localhost:${PORT}/beli/`);
  console.log(`  admin        : http://localhost:${PORT}/admin/  (password: ${process.env.ADMIN_PASSWORD ? 'dari ADMIN_PASSWORD' : 'admin'})`);
});
