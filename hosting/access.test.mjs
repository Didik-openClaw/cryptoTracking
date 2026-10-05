import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler, fileStore } from '../server/node.mjs';
import { runConformance } from './test/conformance.mjs';

// The same end-to-end checks run against both implementations of paid access:
// the PHP gate/API for shared hosting and the Node server for a VPS.

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ADMIN = 'conformance-admin-pw';

async function site(dir) {
  const web = join(dir, 'public_html');
  for (const d of ['assets', 'beli', 'data']) await mkdir(join(web, d), { recursive: true });
  await writeFile(join(web, 'index.html'), '<!doctype html><div id="root"></div><script src="./assets/app.js"></script>');
  await writeFile(join(web, 'assets', 'app.js'), 'terminal()');
  await writeFile(join(web, 'beli', 'index.html'), '<!doctype html><div id="root"></div>');
  await writeFile(join(web, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  return web;
}

let php = false;
try {
  execFileSync('php', ['-v'], { stdio: 'ignore' });
  php = true;
} catch {
  /* no PHP here: the PHP half is skipped */
}

describe.skipIf(!php)('PHP access (shared hosting)', () => {
  let dir;
  let proc;
  let base;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dty-php-'));
    const web = await site(dir);
    await cp(join(HERE, 'public_html'), web, { recursive: true });
    await mkdir(join(dir, 'dty-private'), { recursive: true });
    const hash = execFileSync('php', ['-r', 'echo password_hash(stream_get_contents(STDIN), PASSWORD_DEFAULT);'], { input: ADMIN });
    await writeFile(join(dir, 'dty-private', 'admin.hash'), hash);
    const port = 18000 + Math.floor(Math.random() * 2000);
    base = `http://127.0.0.1:${port}`;
    proc = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', web, join(HERE, 'test', 'router.php')], { stdio: 'ignore' });
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`${base}/api/config`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('php -S did not start');
  });
  afterAll(async () => {
    proc?.kill();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('passes the end-to-end access checks', async () => {
    const results = await runConformance(base, ADMIN);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.length).toBeGreaterThan(25);
  });

  it('serves the PHP folder and hidden files to nobody', async () => {
    for (const p of ['/_dty/core.php', '/.htaccess', '/beli/..%2fassets/app.js']) {
      const res = await fetch(base + p, { redirect: 'manual' });
      expect(res.status, p).not.toBe(200);
      expect(await res.text(), p).not.toMatch(/terminal\(\)|<\?php/);
    }
  });
});

describe('Node access (VPS / local)', () => {
  let dir;
  let server;
  let base;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dty-node-'));
    const web = await site(dir);
    const store = await fileStore(join(dir, 'data'));
    server = createServer(createHandler({ dist: web, env: { sessionSecret: 'x'.repeat(40), adminPassword: ADMIN }, store }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    server?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('passes the same end-to-end access checks', async () => {
    const results = await runConformance(base, ADMIN);
    expect(results.filter((r) => !r.ok)).toEqual([]);
  });
});
