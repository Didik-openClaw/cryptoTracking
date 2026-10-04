#!/usr/bin/env node
// Collects recent crypto headlines from public RSS feeds at build time and
// writes public/data/news.json. The site uses it only when the live news
// APIs cannot be reached. Failure is not fatal.
import { mkdir, writeFile } from 'node:fs/promises';
import { parseRss } from './rss.mjs';

const FEEDS = [
  ['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/'],
  ['Cointelegraph', 'https://cointelegraph.com/rss'],
  ['The Block', 'https://www.theblock.co/rss.xml'],
  ['Decrypt', 'https://decrypt.co/feed'],
];
const OUT_DIR = new URL('../public/data/', import.meta.url);
const MAX_ITEMS = 150;

async function fetchFeed([source, url]) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'hl-whale-tracker (+github pages build)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRss(await res.text(), source);
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.allSettled(FEEDS.map(fetchFeed));
const items = [];
results.forEach((r, i) => {
  if (r.status === 'fulfilled') items.push(...r.value);
  else console.warn(`[news] ${FEEDS[i][0]} dilewati: ${r.reason?.message ?? r.reason}`);
});
const seen = new Set();
const unique = items
  .sort((a, b) => b.publishedAt - a.publishedAt)
  .filter((i) => !seen.has(i.title.toLowerCase()) && seen.add(i.title.toLowerCase()))
  .slice(0, MAX_ITEMS);
if (unique.length) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(new URL('news.json', OUT_DIR), JSON.stringify({ generatedAt: Date.now(), items: unique }));
  console.log(`[news] ${unique.length} headline ditulis ke public/data/news.json`);
} else {
  console.warn('[news] tidak ada headline; situs memakai API berita langsung dari browser.');
}
