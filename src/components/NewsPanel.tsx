import { useMemo, useState } from 'react';
import { fmtAge, fmtDateTime, fmtShortDateTime, fmtTime } from '../lib/format';
import { mode } from '../lib/mode';
import { isHyperliquidNews, matchesCoin, news, newsSourceLabel, type NewsItem } from '../lib/news';
import { useObservable } from '../lib/observable';
import { WIRE_LABEL, wire, type WireEvent } from '../lib/wire';
import { Addr } from './Addr';
import { Seg, Spinner, Tabs } from './ui';

type Tab = 'news' | 'wire';
type Scope = 'coin' | 'hl' | 'all';

const MAX_SHOWN = 80;

/** Headline time: "14:05" today, "02 Okt 14:05" before that. */
function stamp(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? fmtTime(ms).slice(0, 5) : fmtShortDateTime(ms);
}

/**
 * Side panel next to a chart: external crypto headlines ("BERITA") and the
 * app's own Hyperliquid event stream ("WIRE"), filtered to `coin` by default.
 */
export function NewsPanel({ coin }: { coin?: string }) {
  useObservable(news);
  useObservable(wire);
  const [tab, setTab] = useState<Tab>(mode.demo ? 'wire' : 'news');
  const [scope, setScope] = useState<Scope>(coin ? 'coin' : 'all');

  const headlines = useMemo(() => {
    if (scope === 'coin' && coin) return news.items.filter((i) => matchesCoin(i, coin));
    if (scope === 'hl') return news.items.filter(isHyperliquidNews);
    return news.items;
  }, [news.items, scope, coin]);

  const events = useMemo(() => {
    if (scope === 'coin' && coin) return wire.events.filter((e) => e.coin === coin);
    if (scope === 'hl') return wire.events.filter((e) => e.kind === 'block' || e.kind === 'whale' || e.kind === 'liq');
    return wire.events;
  }, [wire.events, scope, coin]);

  const scopes: { value: Scope; label: string }[] = [
    ...(coin ? [{ value: 'coin' as const, label: coin }] : []),
    { value: 'hl', label: tab === 'news' ? 'Hyperliquid' : 'Whale' },
    { value: 'all', label: 'Semua' },
  ];

  return (
    <section className="panel news-panel">
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'news', label: 'Berita', count: news.status === 'ok' ? headlines.length : undefined },
          { id: 'wire', label: 'Wire', count: events.length },
        ]}
      />
      <div className="row news-tools">
        <Seg<Scope> value={scope} onChange={setScope} options={scopes} />
        {tab === 'news' && news.status === 'ok' && (
          <span className="dim small grow right" title={news.error || undefined}>
            {newsSourceLabel(news.source)} · {fmtTime(news.updatedAt)}
            <button type="button" className="icon-btn" title="Muat ulang berita" onClick={() => void news.refresh()}>
              ↻
            </button>
          </span>
        )}
        {tab === 'wire' && <span className="dim small grow right">real-time dari data Hyperliquid</span>}
      </div>
      {tab === 'news' ? <Headlines items={headlines} scope={scope} coin={coin} onAll={() => setScope('all')} /> : <WireList events={events} />}
    </section>
  );
}

function Headlines({ items, scope, coin, onAll }: { items: NewsItem[]; scope: Scope; coin?: string; onAll: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (news.status === 'unavailable')
    return (
      <div className="news-empty">
        <b>Berita eksternal tidak dimuat di mode demo.</b> Sandbox demo memblokir koneksi ke luar, dan demo tidak memakai
        headline karangan. Di versi live, headline diambil dari CoinDesk Data / CryptoCompare dan RSS. Lihat tab <b>WIRE</b> untuk
        kabar pasar (simulasi).
      </div>
    );
  if (news.status === 'loading' || news.status === 'idle')
    return (
      <div className="news-empty">
        <Spinner /> Memuat berita…
      </div>
    );
  if (news.status === 'error')
    return (
      <div className="news-empty">
        <b>Berita belum bisa dimuat.</b> Isi API key gratis CoinDesk Data di Pengaturan untuk batas request lebih tinggi, atau tunggu
        snapshot RSS dari build berikutnya.
        <div className="dim small" style={{ marginTop: 6 }}>
          {news.error}
        </div>
      </div>
    );
  if (!items.length)
    return (
      <div className="news-empty">
        Belum ada berita {scope === 'coin' ? `tentang ${coin}` : 'Hyperliquid'} di {news.items.length} headline terbaru.{' '}
        <button type="button" className="btn sm" onClick={onAll}>
          Lihat semua
        </button>
      </div>
    );
  const now = Date.now();
  return (
    <ul className="news-list">
      {items.slice(0, MAX_SHOWN).map((n) => (
        <li key={n.id} className={`news-item${news.fresh.has(n.id) ? ' flash' : ''}`}>
          <div className="news-meta">
            <span className="t" title={fmtDateTime(n.publishedAt)}>
              {stamp(n.publishedAt)}
            </span>
            <span className="age">{fmtAge(n.publishedAt, now)}</span>
            <span className="src">{n.source}</span>
            {n.sentiment === 'pos' && <span className="pos" title="Sentimen positif">▲</span>}
            {n.sentiment === 'neg' && <span className="neg" title="Sentimen negatif">▼</span>}
            {n.tags.slice(0, 3).map((t) => (
              <span key={t} className="ntag">
                {t}
              </span>
            ))}
          </div>
          <a className="news-title" href={n.url} target="_blank" rel="noreferrer">
            {n.title}
          </a>
          {n.body && (
            <>
              <button type="button" className="news-more" onClick={() => setOpen(open === n.id ? null : n.id)}>
                {open === n.id ? 'tutup' : 'ringkasan'}
              </button>
              {open === n.id && <p className="news-body">{n.body}</p>}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function WireList({ events }: { events: WireEvent[] }) {
  if (!events.length)
    return (
      <div className="news-empty">
        Belum ada kejadian. WIRE mencatat blok trade whale, posisi whale baru, harga bergerak tajam dalam 15 menit, funding ekstrem,
        lonjakan open interest, dan whale yang mendekati likuidasi, sejak halaman ini dibuka.
      </div>
    );
  const now = Date.now();
  return (
    <ul className="news-list">
      {events.slice(0, MAX_SHOWN).map((e) => (
        <li key={e.id} className={`news-item${now - e.time < 4000 ? ' flash' : ''}`}>
          <div className="news-meta">
            <span className="t">{fmtTime(e.time)}</span>
            <span className={`wkind ${e.tone}`}>{WIRE_LABEL[e.kind]}</span>
            <a className="coin-link small" href={`#/coin/${encodeURIComponent(e.coin)}`}>
              {e.coin}
            </a>
          </div>
          <div className={`news-title ${e.tone}`}>{e.title}</div>
          <div className="news-body dim">
            {e.detail}
            {e.address && (
              <>
                {' '}
                <Addr address={e.address} star={false} />
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
