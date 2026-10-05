#!/usr/bin/env node
// Turns dist/ into the upload for PHP shared hosting (Hostinger): copies
// hosting/public_html (.htaccess + the _dty PHP gate and API) over it, and
// writes .gz copies of the gated text files, which _dty/gate.php sends to
// browsers that accept gzip (public pages are compressed by the web server).
//
//   npm run build:hosting            → dist/ ready to upload to public_html
import { cp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, process.argv[2] ?? 'dist');
const PUBLIC = /^(beli|demo|admin)(\/|$)/;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

await cp(join(ROOT, 'hosting', 'public_html'), DIST, { recursive: true });

let gz = 0;
for await (const file of walk(DIST)) {
  const rel = relative(DIST, file).split(sep).join('/');
  if (file.endsWith('.gz')) await rm(file);
  else if (/\.(js|css|json|svg|html)$/.test(rel) && !PUBLIC.test(rel) && !rel.startsWith('_dty/')) {
    const body = await readFile(file);
    if (body.length < 1024) continue;
    await writeFile(`${file}.gz`, gzipSync(body, { level: 9 }));
    gz++;
  }
}
console.log(`[hosting] PHP gate + .htaccess copied into ${relative(ROOT, DIST) || '.'}/, ${gz} gzip copies written`);
