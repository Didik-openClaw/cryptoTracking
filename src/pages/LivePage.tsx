import { useMemo, useRef, useState } from 'react';
import { Addr } from '../components/Addr';
import { Empty, LongShortBar, SideBadge, StatCard, UsdSelect } from '../components/ui';
import { fmtAgo, fmtCount, fmtPx, fmtSize, fmtTime, fmtUsd, pnlClass } from '../lib/format';
import { plural, tr } from '../lib/i18n';
import { live, LIVE_KEEP_FLOOR_USD, type BigTrade } from '../lib/live';
import { useObservable } from '../lib/observable';
import { scanner } from '../lib/scanner';
import { settings } from '../lib/settings';
import { socket } from '../lib/ws';

const WINDOWS = [
  { ms: 5 * 60_000, label: () => tr('5 menit', '5 min') },
  { ms: 15 * 60_000, label: () => tr('15 menit', '15 min') },
  { ms: 60 * 60_000, label: () => tr('1 jam', '1 hour') },
];
const ROWS = 300;

export function LivePage() {
  const lv = useObservable(live);
  useObservable(settings);
  useObservable(socket);
  useObservable(scanner);
  const s = settings.value;
  const [coin, setCoin] = useState('all');
  const [paused, setPaused] = useState(false);
  const frozen = useRef<BigTrade[] | null>(null);
  if (paused && !frozen.current) frozen.current = live.trades;
  if (!paused) frozen.current = null;
  const source = frozen.current ?? live.trades;

  const trades = useMemo(
    () => source.filter((t) => t.notional >= s.liveMinUsd && (coin === 'all' || t.coin === coin)),
    [source, s.liveMinUsd, coin, lv],
  );
  const coins = useMemo(() => [...new Set(live.trades.map((t) => t.coin))].sort(), [lv]);

  const now = Date.now();
  const windows = WINDOWS.map((w) => {
    let buy = 0,
      sell = 0,
      n = 0;
    for (const t of trades) {
      if (now - t.time > w.ms) break; // newest first
      if (t.side === 'buy') buy += t.notional;
      else sell += t.notional;
      n++;
    }
    return { ...w, buy, sell, n };
  });

  const topTakers = useMemo(() => {
    const hourAgo = Date.now() - 3_600_000;
    const m = new Map<string, { address: string; buy: number; sell: number; n: number }>();
    for (const t of trades) {
      if (t.time < hourAgo) break; // newest first
      let x = m.get(t.taker);
      if (!x) m.set(t.taker, (x = { address: t.taker, buy: 0, sell: 0, n: 0 }));
      if (t.side === 'buy') x.buy += t.notional;
      else x.sell += t.notional;
      x.n++;
    }
    return [...m.values()].sort((a, b) => b.buy + b.sell - (a.buy + a.sell)).slice(0, 10);
  }, [trades]);

  const wsOk = socket.status === 'open';

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            <span className="fn">BLKT</span>
            {tr('Trade Besar Live', 'Live Block Trades')}
          </h1>
          <p>
            {tr(
              <>
                Market order ≥ {fmtUsd(s.liveMinUsd, { decimals: 0 })} di {live.coins.length} perp teratas, real-time. Fill dari
                satu order digabung. Trader besar otomatis dipindai posisinya.
              </>,
              <>
                Market orders ≥ {fmtUsd(s.liveMinUsd, { decimals: 0 })} on the top {live.coins.length} perps, real-time. Fills
                from one order are merged. Large traders&apos; positions are scanned automatically.
              </>,
            )}
          </p>
        </div>
        <div className="row">
          <span className="muted small">{tr('Trade minimal', 'Min. trade')}</span>
          <UsdSelect
            value={s.liveMinUsd}
            onChange={(v) => settings.update({ liveMinUsd: v })}
            presets={[100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000]}
          />
        </div>
      </div>

      {!wsOk && (
        <div className="notice">
          {socket.status === 'connecting'
            ? tr('Menghubungkan ke websocket Hyperliquid…', 'Connecting to Hyperliquid websocket…')
            : tr('Websocket terputus, mencoba menyambung ulang…', 'Websocket disconnected, reconnecting…')}
        </div>
      )}

      <div className="cards">
        {windows.map((w) => (
          <StatCard
            key={w.ms}
            label={tr(`Arus trade besar ${w.label()}`, `Block trade flow ${w.label()}`)}
            value={
              <span className={pnlClass(w.buy - w.sell)}>
                {fmtUsd(w.buy - w.sell, { sign: true })}
              </span>
            }
            sub={
              <>
                <LongShortBar long={w.buy} short={w.sell} />
                <div style={{ marginTop: 6 }}>
                  <span className="pos">{tr('Beli', 'Buy')} {fmtUsd(w.buy)}</span> ·{' '}
                  <span className="neg">{tr('Jual', 'Sell')} {fmtUsd(w.sell)}</span> · {tr(`${w.n} trade`, plural(w.n, 'trade'))}
                </div>
              </>
            }
          />
        ))}
        <StatCard
          label={tr('Aliran data', 'Data stream')}
          value={fmtCount(live.fillsSeen)}
          sub={tr(
            `fill diterima · ${fmtCount(live.ordersSeen)} order · mulai ${fmtAgo(live.startedAt, now)}`,
            `fills received · ${fmtCount(live.ordersSeen)} orders · started ${fmtAgo(live.startedAt, now)}`,
          )}
        />
      </div>

      <div className="grid-main">
        <section className="panel">
          <div className="panel-head">
            <h2>
              Feed {paused && <span className="tag warn">{tr('dijeda', 'paused')}</span>}
            </h2>
            <div className="row">
              <select className="input" value={coin} onChange={(e) => setCoin(e.target.value)}>
                <option value="all">{tr('Semua coin', 'All coins')}</option>
                {coins.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <label className="check small">
                <input type="checkbox" checked={s.liveSound} onChange={(e) => settings.update({ liveSound: e.target.checked })} />
                {tr('Bunyi', 'Sound')}
              </label>
              <button type="button" className="btn sm" onClick={() => setPaused(!paused)}>
                {paused ? tr('Lanjutkan', 'Resume') : tr('Jeda tampilan', 'Pause view')}
              </button>
              <button type="button" className="btn sm ghost" onClick={() => live.clear()}>
                {tr('Bersihkan', 'Clear')}
              </button>
            </div>
          </div>
          {trades.length ? (
            <div className="table-wrap table-scroll" style={{ maxHeight: 760 }}>
              <table>
                <thead>
                  <tr>
                    <th>{tr('Waktu', 'Time')}</th>
                    <th>Coin</th>
                    <th>{tr('Arah', 'Side')}</th>
                    <th className="num">{tr('Nilai', 'Value')}</th>
                    <th className="num">Size</th>
                    <th className="num">{tr('Harga rata²', 'Avg. Price')}</th>
                    <th className="num">{tr('Fill', 'Fills')}</th>
                    <th>Trader (taker)</th>
                    <th>{tr('Posisi trader saat ini', 'Trader position now')}</th>
                    <th>{tr('Lawan terbesar (maker)', 'Top counterparty (maker)')}</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.slice(0, ROWS).map((t) => (
                    <tr key={t.id} className={now - t.time < 4000 ? 'flash' : ''}>
                      <td className="nowrap muted small">{fmtTime(t.time)}</td>
                      <td>
                        <a className="coin-link" href={`#/coin/${encodeURIComponent(t.coin)}`}>
                          {t.coin}
                        </a>
                      </td>
                      <td>
                        <SideBadge side={t.side} />
                      </td>
                      <td className="num">
                        <b className={t.side === 'buy' ? 'pos' : 'neg'}>{fmtUsd(t.notional)}</b>
                      </td>
                      <td className="num muted">{fmtSize(t.size)}</td>
                      <td className="num">{fmtPx(t.avgPx)}</td>
                      <td className="num dim">{t.fills}</td>
                      <td>{t.taker ? <Addr address={t.taker} /> : <span className="dim">–</span>}</td>
                      <td>
                        <CurrentPosition address={t.taker} coin={t.coin} />
                      </td>
                      <td>
                        {t.topMaker ? (
                          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <Addr address={t.topMaker.address} star={false} />
                            <span className="dim small">{fmtUsd(t.topMaker.usd)}</span>
                          </span>
                        ) : (
                          <span className="dim">–</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>
              <b>{tr(`Menunggu trade ≥ ${fmtUsd(s.liveMinUsd)}…`, `Waiting for trades ≥ ${fmtUsd(s.liveMinUsd)}…`)}</b>
              <br />
              {tr(
                <>
                  Trade besar akan muncul otomatis. Turunkan batas minimal (paling rendah {fmtUsd(LIVE_KEEP_FLOOR_USD)}) untuk
                  melihat lebih banyak.
                </>,
                <>Block trades appear automatically. Lower the minimum (down to {fmtUsd(LIVE_KEEP_FLOOR_USD)}) to see more.</>,
              )}
            </Empty>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{tr('Trader paling agresif (1 jam)', 'Most aggressive traders (1h)')}</h2>
          </div>
          {topTakers.length ? (
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Trader</th>
                    <th className="num">{tr('Beli', 'Buy')}</th>
                    <th className="num">{tr('Jual', 'Sell')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topTakers.map((x) => (
                    <tr key={x.address}>
                      <td>
                        <Addr address={x.address} />
                        <div className="dim small">{tr(`${x.n} trade`, plural(x.n, 'trade'))}</div>
                      </td>
                      <td className="num pos">{x.buy ? fmtUsd(x.buy) : '–'}</td>
                      <td className="num neg">{x.sell ? fmtUsd(x.sell) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{tr('Belum ada data.', 'No data yet.')}</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

function CurrentPosition({ address, coin }: { address: string; coin: string }) {
  const w = scanner.wallets.get(address);
  const p = w?.positions.find((x) => x.coin === coin);
  if (!w) {
    const scanned = scanner.lastScannedAt(address);
    return (
      <span className="dim small">{scanned ? tr('tidak ada posisi besar', 'no large position') : tr('memindai…', 'scanning…')}</span>
    );
  }
  if (!p) return <span className="dim small">{tr(`tidak ada posisi ${coin}`, `no ${coin} position`)}</span>;
  return (
    <span className="nowrap">
      <SideBadge side={p.side} /> <b>{fmtUsd(p.positionValue)}</b> <span className="dim small">@ {fmtPx(p.entryPx)}</span>
    </span>
  );
}
