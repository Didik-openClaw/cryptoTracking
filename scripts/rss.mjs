// Minimal RSS 2.0 parser for build-time headline snapshots (no dependencies).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? decode(m[1]).trim() : '';
};

const plain = (html, max = 280) => {
  const t = decode(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Parse an RSS feed into the app's NewsItem shape (see src/lib/news.ts). */
export function parseRss(xml, source) {
  const items = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const it = m[1];
    const title = plain(tag(it, 'title'), 300);
    const url = tag(it, 'link') || tag(it, 'guid');
    const time = Date.parse(tag(it, 'pubDate') || tag(it, 'dc:date'));
    if (!title || !/^https?:\/\//.test(url) || !Number.isFinite(time)) continue;
    const tags = [...it.matchAll(/<category\b[^>]*>([\s\S]*?)<\/category>/gi)].map((c) => plain(c[1], 40).toUpperCase());
    items.push({
      id: url,
      title,
      url,
      source,
      publishedAt: time,
      body: plain(tag(it, 'description')),
      tags: [...new Set(tags)].slice(0, 6),
      sentiment: null,
    });
  }
  return items;
}
