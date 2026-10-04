import { describe, expect, it } from 'vitest';
import { decode, parseRss } from './rss.mjs';

describe('parseRss', () => {
  it('reads items with CDATA, entities and categories', () => {
    const xml = `<rss><channel><title>Feed</title>
      <item>
        <title><![CDATA[Bitcoin tops $70K as ETF inflows &amp; open interest climb]]></title>
        <link>https://example.com/a</link>
        <pubDate>Sat, 04 Oct 2026 08:00:00 GMT</pubDate>
        <description><![CDATA[<p>Markets <b>rallied</b> on Saturday.</p>]]></description>
        <category>Markets</category><category>Bitcoin</category>
      </item>
      <item><title>No link</title><pubDate>Sat, 04 Oct 2026 07:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const items = parseRss(xml, 'Example');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Bitcoin tops $70K as ETF inflows & open interest climb',
      url: 'https://example.com/a',
      source: 'Example',
      publishedAt: Date.UTC(2026, 9, 4, 8),
      body: 'Markets rallied on Saturday.',
      tags: ['MARKETS', 'BITCOIN'],
    });
  });

  it('decodes numeric entities', () => {
    expect(decode('Ether&#8217;s &#x2014; rally')).toBe('Ether’s — rally');
  });
});
