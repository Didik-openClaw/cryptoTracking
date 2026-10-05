import { useState } from 'react';
import { fmtAgo, fmtPct, fmtPx, fmtSize, fmtUsd } from '../lib/format';
import { tr } from '../lib/i18n';
import { market } from '../lib/market';
import { useObservable } from '../lib/observable';
import { analyzeBook, SIG_FIGS, useOrderBook, type BookLevel } from '../lib/orderbook';
import { LongShortBar, Seg, Spinner } from './ui';

const WALL_OPTIONS = [250_000, 500_000, 1_000_000, 5_000_000];
const ROWS = 12;

/** One side of the ladder; asks are drawn far-to-near so the spread sits in the middle. */
function Side({ levels, side, maxUsd, wallCut }: { levels: BookLevel[]; side: 'bid' | 'ask'; maxUsd: number; wallCut: number }) {
  const rows = levels.slice(0, ROWS);
  const shown = side === 'ask' ? [...rows].reverse() : rows;
  return (
    <>
      {shown.map((l) => {
        const wall = l.usd >= wallCut;
        return (
          <tr key={`${side}${l.px}`} className={`ob-row ${side}${wall ? ' wall' : ''}`}>
            <td className={`num ${side === 'bid' ? 'pos' : 'neg'}`}>
              <i className="ob-bar" style={{ width: `${Math.min(100, (l.cumUsd / maxUsd) * 100)}%` }} />
              {fmtPx(l.px)}
            </td>
            <td className="num">{fmtSize(l.sz)}</td>
            <td className="num">{wall ? <b className="ob-wall">{fmtUsd(l.usd)}</b> : fmtUsd(l.usd)}</td>
            <td className="num dim">{fmtUsd(l.cumUsd)}</td>
          </tr>
        );
      })}
    </>
  );
}

/** Live L2 order book for a coin: ladder with depth bars, depth around mid, imbalance and whale walls. */
export function OrderBook({ coin }: { coin: string }) {
  useObservable(market);
  const [sig, setSig] = useState<number>(0);
  const [wallUsd, setWallUsd] = useState(1_000_000);
  const { book, error, updatedAt, pending } = useOrderBook(coin, sig || null);
  const a = book ? analyzeBook(book, { wallUsd, liveMid: market.mids.get(coin) }) : null;
  const maxUsd = book ? Math.max(book.bids[Math.min(ROWS, book.bids.length) - 1]?.cumUsd ?? 0, book.asks[Math.min(ROWS, book.asks.length) - 1]?.cumUsd ?? 0, 1) : 1;

  return (
    <section className="panel ob">
      <div className="panel-head">
        <h2>Order book · {coin}</h2>
        <span className="hint">
          {updatedAt ? tr(`diperbarui ${fmtAgo(updatedAt)}`, `updated ${fmtAgo(updatedAt)}`) : ''}
          {pending ? ' …' : ''}
        </span>
      </div>
      <div className="ob-tools">
        <label className="field">
          <span>{tr('Presisi', 'Precision')}</span>
          <Seg<number>
            value={sig}
            onChange={setSig}
            options={[{ value: 0, label: 'Full' }, ...[...SIG_FIGS].reverse().map((s) => ({ value: s, label: `${s}sf` }))]}
          />
        </label>
        <label className="field">
          <span>{tr('Wall minimal', 'Min. wall')}</span>
          <Seg<number> value={wallUsd} onChange={setWallUsd} options={WALL_OPTIONS.map((v) => ({ value: v, label: fmtUsd(v, { decimals: 0 }) }))} />
        </label>
      </div>
      {!book || !a ? (
        <div className="ob-empty">{error ? <span className="danger">{error}</span> : <Spinner />}</div>
      ) : (
        <>
          <dl className="kv ob-stats">
            <dt>Mid</dt>
            <dd>{fmtPx(a.mid)}</dd>
            <dt>Spread</dt>
            <dd>{a.spread ? `${fmtPx(a.spread.abs)} · ${a.spread.bps.toFixed(2)} bps` : '–'}</dd>
          </dl>
          <div className="table-wrap">
            <table className="ob-ladder">
              <thead>
                <tr>
                  <th className="num">{tr('Harga', 'Price')}</th>
                  <th className="num">Size</th>
                  <th className="num">USD</th>
                  <th className="num">{tr('Kumulatif', 'Total')}</th>
                </tr>
              </thead>
              <tbody>
                <Side levels={book.asks} side="ask" maxUsd={maxUsd} wallCut={a.wallCut} />
                <tr className="ob-mid">
                  <td colSpan={4}>
                    {fmtPx(a.mid)} <span className="dim">· spread {a.spread ? `${a.spread.bps.toFixed(1)} bps` : '–'}</span>
                  </td>
                </tr>
                <Side levels={book.bids} side="bid" maxUsd={maxUsd} wallCut={a.wallCut} />
              </tbody>
            </table>
          </div>

          <h3 className="ob-sub">{tr('Kedalaman di sekitar mid', 'Depth around mid')}</h3>
          <table className="ob-depth">
            <tbody>
              {a.bands.map((b) => (
                <tr key={b.pct}>
                  <td className="dim">±{fmtPct(b.pct, { decimals: b.pct < 0.01 ? 1 : 0 })}</td>
                  <td className="num pos">
                    {fmtUsd(b.bidUsd)}
                    {!b.bidComplete && '+'}
                  </td>
                  <td style={{ width: '40%' }}>
                    <LongShortBar long={b.bidUsd} short={b.askUsd} />
                  </td>
                  <td className="num neg">
                    {fmtUsd(b.askUsd)}
                    {!b.askComplete && '+'}
                  </td>
                  <td className={`num ${b.imbalance > 0 ? 'pos' : b.imbalance < 0 ? 'neg' : ''}`}>{fmtPct(b.imbalance, { sign: true, decimals: 0 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="dim small ob-note">
            {tr(
              'Imbalance = (bid − ask) / (bid + ask). Tanda + berarti buku hanya terlihat sebagian di rentang itu; pakai presisi lebih kasar untuk melihat lebih jauh.',
              'Imbalance = (bid − ask) / (bid + ask). A + means the book is only partly visible in that range; use a coarser precision to see further.',
            )}
          </p>

          <h3 className="ob-sub">
            Whale walls <span className="dim">≥ {fmtUsd(a.wallCut, { decimals: 1 })}</span>
          </h3>
          {a.walls.length ? (
            <table className="ob-walls">
              <tbody>
                {a.walls.slice(0, 8).map((w) => (
                  <tr key={`${w.side}${w.px}`}>
                    <td className={w.side === 'bid' ? 'pos' : 'neg'}>{w.side === 'bid' ? 'BID' : 'ASK'}</td>
                    <td className="num">{fmtPx(w.px)}</td>
                    <td className="num">
                      <b>{fmtUsd(w.usd)}</b>
                    </td>
                    <td className="num dim">{fmtPct(w.distance, { decimals: 2 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="dim small">{tr('Tidak ada wall sebesar itu di buku yang terlihat.', 'No wall that large in the visible book.')}</p>
          )}
        </>
      )}
    </section>
  );
}
