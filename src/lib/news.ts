import { mode } from './mode';
import { Observable } from './observable';
import { settings } from './settings';

/**
 * Crypto headlines for the news panel. Sources, tried in order:
 *  1. CoinDesk Data API (successor of CryptoCompare news),
 *  2. CryptoCompare min-api news,
 *  3. data/news.json: RSS headlines (CoinDesk, Cointelegraph, The Block,
 *     Decrypt) collected at build time by scripts/fetch-news.mjs.
 * An optional API key from Settings is passed to 1 and 2 for higher limits.
 */
export const COINDESK_NEWS_URL = 'https://data-api.coindesk.com/news/v1/article/list?lang=EN&limit=60';
export const CRYPTOCOMPARE_NEWS_URL = 'https://min-api.cryptocompare.com/data/v2/news/?lang=EN';
const REFRESH_MS = 120_000;
const MAX_ITEMS = 150;

export type Sentiment = 'pos' | 'neg' | 'neu' | null;

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: number; // ms
  body: string;
  tags: string[]; // upper-case categories, e.g. BTC, ETH, REGULATION
  sentiment: Sentiment;
}

export type NewsSource = 'coindesk' | 'cryptocompare' | 'snapshot';

const SOURCE_LABEL: Record<NewsSource, string> = {
  coindesk: 'CoinDesk Data',
  cryptocompare: 'CryptoCompare',
  snapshot: 'RSS (snapshot build)',
};
export const newsSourceLabel = (s: NewsSource | null) => (s ? SOURCE_LABEL[s] : '–');

type Obj = Record<string, unknown>;
/** Field lookup that accepts both the CryptoCompare (lower-case) and CoinDesk (UPPER-CASE) spellings. */
const field = (o: Obj, name: string): unknown => o[name] ?? o[name.toUpperCase()];
const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

function sentimentOf(v: unknown): Sentiment {
  const s = str(v).toUpperCase();
  return s === 'POSITIVE' ? 'pos' : s === 'NEGATIVE' ? 'neg' : s === 'NEUTRAL' ? 'neu' : null;
}

const clean = (s: string, max = 280) => {
  const t = s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Normalise any of the three source formats into NewsItems, newest first. */
export function parseNews(json: unknown): NewsItem[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Obj;
  // Our snapshot file is already normalised.
  if (Array.isArray(root.items)) return (root.items as NewsItem[]).filter((i) => i?.title && i?.url);
  const rows = (Array.isArray(root.Data) ? root.Data : Array.isArray(root.data) ? root.data : []) as Obj[];
  const out: NewsItem[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const title = clean(str(field(r, 'title')), 300);
    const url = str(field(r, 'url'));
    if (!title || !/^https?:\/\//.test(url)) continue;
    const sourceData = (field(r, 'source_data') ?? field(r, 'source_info')) as Obj | undefined;
    const source = str(sourceData && (field(sourceData, 'name') as string)) || str(field(r, 'source')) || str(field(r, 'source_id'));
    // CoinDesk: CATEGORY_DATA [{CATEGORY}], CryptoCompare: categories "BTC|Trading"
    const catData = field(r, 'category_data');
    const tags = Array.isArray(catData)
      ? catData.map((c) => str((c as Obj).CATEGORY ?? (c as Obj).NAME ?? (c as Obj).name))
      : str(field(r, 'categories')).split('|');
    const published = Number(field(r, 'published_on'));
    out.push({
      id: str(field(r, 'id')) || str(field(r, 'guid')) || url,
      title,
      url,
      source: source || 'News',
      publishedAt: Number.isFinite(published) ? published * 1000 : 0,
      body: clean(str(field(r, 'body'))),
      tags: [...new Set(tags.map((t) => t.trim().toUpperCase()).filter(Boolean))],
      sentiment: sentimentOf(field(r, 'sentiment')),
    });
  }
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}

/** Names news outlets use for Hyperliquid tickers. */
const ALIASES: Record<string, string[]> = {
  BTC: ['Bitcoin'],
  ETH: ['Ethereum', 'Ether'],
  SOL: ['Solana'],
  HYPE: ['Hyperliquid', 'HyperEVM', 'HLP'],
  XRP: ['Ripple'],
  DOGE: ['Dogecoin'],
  SUI: ['Sui'],
  AVAX: ['Avalanche'],
  LINK: ['Chainlink'],
  BNB: ['BNB Chain', 'Binance Coin'],
  kPEPE: ['PEPE', 'Pepe'],
  kBONK: ['BONK', 'Bonk'],
  kSHIB: ['SHIB', 'Shiba Inu'],
  ENA: ['Ethena'],
  TAO: ['Bittensor'],
  WIF: ['dogwifhat'],
  AAVE: ['Aave'],
  ADA: ['Cardano'],
  DOT: ['Polkadot'],
  TRX: ['Tron'],
  TON: ['Toncoin'],
  LTC: ['Litecoin'],
  ARB: ['Arbitrum'],
  OP: ['Optimism'],
  NEAR: ['NEAR Protocol'],
  APT: ['Aptos'],
  TIA: ['Celestia'],
  INJ: ['Injective'],
  JUP: ['Jupiter'],
  ZEC: ['Zcash'],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Does this headline concern `coin` (by tag, ticker or common name)? */
export function matchesCoin(item: NewsItem, coin: string): boolean {
  const symbol = coin.replace(/^k(?=[A-Z])/, ''); // kPEPE -> PEPE
  if (item.tags.includes(coin.toUpperCase()) || item.tags.includes(symbol.toUpperCase())) return true;
  const text = `${item.title} ${item.body}`;
  if (new RegExp(`(^|[^A-Za-z0-9$])\\$?${escapeRe(symbol)}([^A-Za-z0-9]|$)`).test(text)) return true;
  return (ALIASES[coin] ?? []).some((name) => new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(text));
}

export const isHyperliquidNews = (item: NewsItem) => matchesCoin(item, 'HYPE') || /\bHIP-3\b/i.test(item.title);

async function getJson(url: string): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

class NewsStore extends Observable {
  items: NewsItem[] = [];
  status: 'idle' | 'loading' | 'ok' | 'error' | 'unavailable' = 'idle';
  source: NewsSource | null = null;
  error = '';
  updatedAt = 0;
  /** Ids seen before the latest refresh, so the panel can flash new headlines. */
  private known = new Set<string>();
  fresh = new Set<string>();
  private started = false;

  constructor() {
    super(200);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (mode.demo) {
      // The demo runs in sandboxes that block outside requests; never show invented headlines.
      this.status = 'unavailable';
      this.emit();
      return;
    }
    void this.refresh();
    setInterval(() => void this.refresh(), REFRESH_MS);
  }

  async refresh(): Promise<void> {
    if (mode.demo) return;
    this.status = this.items.length ? 'ok' : 'loading';
    this.emit();
    const key = settings.value.newsApiKey.trim();
    const withKey = (url: string) => (key ? `${url}&api_key=${encodeURIComponent(key)}` : url);
    const attempts: [NewsSource, string][] = [
      ['coindesk', withKey(COINDESK_NEWS_URL)],
      ['cryptocompare', withKey(CRYPTOCOMPARE_NEWS_URL)],
      ['snapshot', './data/news.json'],
    ];
    const errors: string[] = [];
    for (const [source, url] of attempts) {
      try {
        const items = parseNews(await getJson(url));
        if (!items.length) throw new Error('kosong');
        this.apply(items, source);
        return;
      } catch (e) {
        errors.push(`${SOURCE_LABEL[source]}: ${(e as Error).message}`);
      }
    }
    this.status = this.items.length ? 'ok' : 'error';
    this.error = errors.join(' · ');
    this.emit();
  }

  private apply(items: NewsItem[], source: NewsSource): void {
    const first = this.known.size === 0;
    this.fresh = new Set(first ? [] : items.filter((i) => !this.known.has(i.id)).map((i) => i.id));
    for (const i of items) this.known.add(i.id);
    this.items = items.slice(0, MAX_ITEMS);
    this.source = source;
    this.status = 'ok';
    this.error = '';
    this.updatedAt = Date.now();
    this.emit();
  }
}

export const news = new NewsStore();
