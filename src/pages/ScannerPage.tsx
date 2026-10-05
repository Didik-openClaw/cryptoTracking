import { useMemo, useState } from 'react';
import { Addr } from '../components/Addr';
import { PositionsTable } from '../components/PositionsTable';
import { csvFilename, downloadCsv } from '../lib/csv';
import { Empty, LongShortBar, Progress, Seg, StatCard, UsdSelect } from '../components/ui';
import { fmtAgo, fmtCount, fmtDuration, fmtUsd, pnlClass } from '../lib/format';
import { useWhalePositions } from '../hooks';
import { plural, tr } from '../lib/i18n';
import { mode } from '../lib/mode';
import { useObservable } from '../lib/observable';
import { aggregateByCoin } from '../lib/positions';
import { scanner } from '../lib/scanner';
import { settings } from '../lib/settings';
import { watchlist } from '../lib/watchlist';

type SideFilter = 'all' | 'long' | 'short';

const sourceLabel = (): Record<string, string> => ({
  cache: tr('cache browser', 'browser cache'),
  bundled: tr('snapshot situs', 'site snapshot'),
  direct: tr('langsung dari Hyperliquid', 'direct from Hyperliquid'),
  stale: tr('snapshot lama', 'stale snapshot'),
});

export function ScannerPage() {
  useObservable(settings);
  const wv = useObservable(watchlist);
  const s = settings.value;
  const all = useWhalePositions(s.minPositionUsd);

  const [coin, setCoin] = useState('all');
  const [side, setSide] = useState<SideFilter>('all');
  const [minLev, setMinLev] = useState(0);
  const [maxDist, setMaxDist] = useState(0); // 0 = no filter
  const [query, setQuery] = useState('');
  const [onlyWatch, setOnlyWatch] = useState(false);
  const [sortKey, setSortKey] = useState<'notional' | 'dist'>('notional');

  const coins = useMemo(() => [...new Set(all.map((p) => p.coin))].sort(), [all]);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      all.filter(
        (p) =>
          (coin === 'all' || p.coin === coin) &&
          (side === 'all' || p.side === side) &&
          p.leverage >= minLev &&
          (!maxDist || (p.liqDistance !== null && p.liqDistance < maxDist)) &&
          (!onlyWatch || watchlist.has(p.address)) &&
          (!q || p.address.includes(q) || watchlist.labelOf(p.address).toLowerCase().includes(q)),
      ),
    [all, coin, side, minLev, maxDist, onlyWatch, q, wv],
  );

  const totals = useMemo(() => {
    let longUsd = 0,
      shortUsd = 0,
      longPnl = 0,
      shortPnl = 0,
      longN = 0,
      shortN = 0,
      nearLiq = 0;
    for (const p of filtered) {
      if (p.side === 'long') {
        longUsd += p.notional;
        longPnl += p.livePnl;
        longN++;
      } else {
        shortUsd += p.notional;
        shortPnl += p.livePnl;
        shortN++;
      }
      if (p.liqDistance !== null && p.liqDistance < 0.05) nearLiq++;
    }
    return { longUsd, shortUsd, longPnl, shortPnl, longN, shortN, nearLiq, wallets: new Set(filtered.map((p) => p.address)).size };
  }, [filtered]);

  const byCoin = useMemo(() => aggregateByCoin(filtered).slice(0, 12), [filtered]);

  const topWallets = useMemo(() => {
    const m = new Map<string, { address: string; long: number; short: number; pnl: number; n: number }>();
    for (const p of filtered) {
      let w = m.get(p.address);
      if (!w) m.set(p.address, (w = { address: p.address, long: 0, short: 0, pnl: 0, n: 0 }));
      if (p.side === 'long') w.long += p.notional;
      else w.short += p.notional;
      w.pnl += p.livePnl;
      w.n++;
    }
    return [...m.values()].sort((a, b) => b.long + b.short - (a.long + a.short)).slice(0, 12);
  }, [filtered]);

  const pass = scanner.pass;
  const progress = pass.total ? pass.done / pass.total : 0;
  const rate = scanner.scanRate;
  const eta = rate > 0 ? ((pass.total - pass.done) / rate) * 60_000 : 0;
  const total = totals.longUsd + totals.shortUsd;
  const resetFilters = () => {
    setCoin('all');
    setSide('all');
    setMinLev(0);
    setMaxDist(0);
    setQuery('');
    setOnlyWatch(false);
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            <span className="fn">WHAL</span>
            {tr('Scanner Whale', 'Whale Scanner')}
          </h1>
          <p>
            {tr(
              <>
                Posisi perp ≥ {fmtUsd(s.minPositionUsd, { decimals: 0 })}: siapa LONG, siapa SHORT, ukuran, waktu buka, entry,
                dan likuidasi. Harga real-time.
              </>,
              <>
                Perp positions ≥ {fmtUsd(s.minPositionUsd, { decimals: 0 })}: who is LONG, who is SHORT, size, open time,
                entry and liquidation. Real-time prices.
              </>,
            )}
          </p>
        </div>
        <div className="row">
          <span className="muted small">{tr('Posisi minimal', 'Min. position')}</span>
          <UsdSelect value={s.minPositionUsd} onChange={(v) => settings.update({ minPositionUsd: v })} />
        </div>
      </div>

      <ScanStatus progress={progress} eta={eta} rate={rate} />

      <div className="cards">
        <StatCard
          label={tr('Posisi jumbo', 'Large positions')}
          value={fmtCount(filtered.length)}
          sub={tr(`${totals.wallets} wallet · total ${fmtUsd(total)}`, `${plural(totals.wallets, 'wallet')} · total ${fmtUsd(total)}`)}
        />
        <StatCard
          label={tr('Total LONG whale', 'Total whale LONG')}
          tone="long"
          value={<span className="pos">{fmtUsd(totals.longUsd)}</span>}
          sub={
            <>
              {totals.longN} {tr('posisi', 'positions')} · uPnL{' '}
              <span className={pnlClass(totals.longPnl)}>{fmtUsd(totals.longPnl, { sign: true })}</span>
            </>
          }
          onClick={() => setSide('long')}
        />
        <StatCard
          label={tr('Total SHORT whale', 'Total whale SHORT')}
          tone="short"
          value={<span className="neg">{fmtUsd(totals.shortUsd)}</span>}
          sub={
            <>
              {totals.shortN} {tr('posisi', 'positions')} · uPnL{' '}
              <span className={pnlClass(totals.shortPnl)}>{fmtUsd(totals.shortPnl, { sign: true })}</span>
            </>
          }
          onClick={() => setSide('short')}
        />
        <StatCard
          label={tr('Rasio Long / Short', 'Long / Short ratio')}
          value={
            <>
              <span className="pos">{total ? ((totals.longUsd / total) * 100).toFixed(0) : 50}%</span>
              <span className="dim"> / </span>
              <span className="neg">{total ? ((totals.shortUsd / total) * 100).toFixed(0) : 50}%</span>
            </>
          }
          sub={<LongShortBar long={totals.longUsd} short={totals.shortUsd} big />}
        />
        <StatCard
          label={tr('Dekat likuidasi (< 5%)', 'Near liquidation (< 5%)')}
          tone={totals.nearLiq ? 'danger' : undefined}
          value={<span className={totals.nearLiq ? 'danger' : ''}>{totals.nearLiq}</span>}
          sub={tr('Klik untuk lihat posisi yang paling terancam', 'Click to see the most at-risk positions')}
          onClick={() => {
            setMaxDist(0.05);
            setSortKey('dist');
          }}
        />
      </div>

      <div className="grid-2">
        <section className="panel">
          <div className="panel-head">
            <h2>Long vs Short per Coin</h2>
            <a className="small" href="#/coins">
              {tr('Lihat semua coin →', 'View all coins →')}
            </a>
          </div>
          {byCoin.length ? (
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Coin</th>
                    <th className="num">Long</th>
                    <th style={{ width: '32%' }}>{tr('Rasio', 'Ratio')}</th>
                    <th className="num">Short</th>
                    <th className="num">Net</th>
                  </tr>
                </thead>
                <tbody>
                  {byCoin.map((c) => (
                    <tr key={c.coin} className="clickable" onClick={() => (location.hash = `#/coin/${encodeURIComponent(c.coin)}`)}>
                      <td>
                        <span className="coin">{c.coin}</span>
                      </td>
                      <td className="num">
                        {c.longCount ? (
                          <>
                            <span className="pos">{fmtUsd(c.longUsd)}</span> <span className="dim small">({c.longCount})</span>
                          </>
                        ) : (
                          <span className="dim">–</span>
                        )}
                      </td>
                      <td>
                        <LongShortBar long={c.longUsd} short={c.shortUsd} />
                      </td>
                      <td className="num">
                        {c.shortCount ? (
                          <>
                            <span className="neg">{fmtUsd(c.shortUsd)}</span> <span className="dim small">({c.shortCount})</span>
                          </>
                        ) : (
                          <span className="dim">–</span>
                        )}
                      </td>
                      <td className={`num ${pnlClass(c.longUsd - c.shortUsd)}`}>{fmtUsd(c.longUsd - c.shortUsd, { sign: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{tr('Menunggu hasil scan…', 'Waiting for scan results…')}</Empty>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{tr('Whale Terbesar (total eksposur)', 'Largest Whales (total exposure)')}</h2>
            <span className="hint">
              {tr('Net bias: hijau = net long, merah = net short', 'Net bias: green = net long, red = net short')}
            </span>
          </div>
          {topWallets.length ? (
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th className="num">{tr('Eksposur', 'Exposure')}</th>
                    <th style={{ width: '26%' }}>Long / Short</th>
                    <th className="num">uPnL</th>
                  </tr>
                </thead>
                <tbody>
                  {topWallets.map((w) => (
                    <tr key={w.address}>
                      <td>
                        <Addr address={w.address} />
                      </td>
                      <td className="num">
                        <b>{fmtUsd(w.long + w.short)}</b> <span className="dim small">({w.n})</span>
                      </td>
                      <td>
                        <LongShortBar long={w.long} short={w.short} />
                      </td>
                      <td className={`num ${pnlClass(w.pnl)}`}>{fmtUsd(w.pnl, { sign: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>{tr('Menunggu hasil scan…', 'Waiting for scan results…')}</Empty>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Semua Posisi Jumbo', 'All Large Positions')}</h2>
          <span className="hint">
            {tr(
              <>Klik judul kolom untuk mengurutkan · ☆ untuk pantau &amp; dapat alert</>,
              <>Click a column header to sort · ☆ to watch &amp; get alerts</>,
            )}{' '}
            <button
              type="button"
              className="btn sm ghost"
              disabled={!filtered.length}
              onClick={() =>
                downloadCsv(
                  csvFilename('dty-whale-positions'),
                  ['wallet', 'label', 'coin', 'side', 'size', 'value_usd', 'entry', 'mark', 'liq_price', 'liq_distance', 'leverage', 'upnl_usd', 'roe', 'account_value'],
                  filtered.map((p) => [
                    p.address,
                    watchlist.labelOf(p.address),
                    p.coin,
                    p.side,
                    p.size,
                    p.notional,
                    p.entryPx,
                    p.mark,
                    p.liquidationPx,
                    p.liqDistance,
                    p.leverage,
                    p.livePnl,
                    p.liveRoe,
                    p.accountValue,
                  ]),
                )
              }
            >
              Export CSV
            </button>
          </span>
        </div>
        <div className="filters" style={{ marginBottom: 12 }}>
          <label className="field">
            <span>Coin</span>
            <select className="input" value={coin} onChange={(e) => setCoin(e.target.value)}>
              <option value="all">{tr('Semua coin', 'All coins')}</option>
              {coins.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>{tr('Sisi', 'Side')}</span>
            <Seg<SideFilter>
              value={side}
              onChange={setSide}
              options={[
                { value: 'all', label: tr('Semua', 'All') },
                { value: 'long', label: 'Long', cls: 'long' },
                { value: 'short', label: 'Short', cls: 'short' },
              ]}
            />
          </div>
          <label className="field">
            <span>{tr('Leverage min', 'Min leverage')}</span>
            <select className="input" value={minLev} onChange={(e) => setMinLev(Number(e.target.value))}>
              {[0, 2, 5, 10, 20, 25, 40].map((v) => (
                <option key={v} value={v}>
                  {v ? `≥ ${v}x` : tr('Semua', 'All')}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{tr('Jarak likuidasi', 'Liq. distance')}</span>
            <select className="input" value={maxDist} onChange={(e) => setMaxDist(Number(e.target.value))}>
              {[0, 0.02, 0.05, 0.1, 0.2].map((v) => (
                <option key={v} value={v}>
                  {v ? `< ${v * 100}%` : tr('Semua', 'All')}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow" style={{ minWidth: 200 }}>
            <span>{tr('Cari wallet / label', 'Search wallet / label')}</span>
            <input
              className="input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr('0x… atau nama', '0x… or name')}
            />
          </label>
          <label className="check" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={onlyWatch} onChange={(e) => setOnlyWatch(e.target.checked)} />
            {tr('Hanya watchlist', 'Watchlist only')}
          </label>
          <button type="button" className="btn ghost" onClick={resetFilters}>
            {tr('Reset filter', 'Reset filters')}
          </button>
        </div>
        <PositionsTable
          key={sortKey}
          rows={filtered}
          initialSort={sortKey}
          emptyText={
            all.length
              ? tr('Tidak ada posisi yang cocok dengan filter.', 'No positions match the filters.')
              : tr(
                  <>
                    <b>Scanner sedang berjalan.</b>
                    <br />
                    Posisi ≥ {fmtUsd(s.minPositionUsd)} akan muncul di sini begitu ditemukan. Akun terbesar dipindai lebih
                    dulu.
                  </>,
                  <>
                    <b>Scanner is running.</b>
                    <br />
                    Positions ≥ {fmtUsd(s.minPositionUsd)} will show up here as they are found. Largest accounts are scanned
                    first.
                  </>,
                )
          }
        />
      </section>
    </div>
  );
}

function ScanStatus({ progress, eta, rate }: { progress: number; eta: number; rate: number }) {
  const pass = scanner.pass;
  const seed = scanner.seed;
  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="row small">
          <b>
            {scanner.status === 'seeding'
              ? tr('Memuat daftar akun…', 'Loading account list…')
              : scanner.status === 'paused'
                ? tr('Scanner dijeda', 'Scanner paused')
                : tr(
                    `Pass #${pass.n}: ${fmtCount(pass.done)} / ${fmtCount(pass.total)} akun`,
                    `Pass #${pass.n}: ${fmtCount(pass.done)} / ${fmtCount(pass.total)} accounts`,
                  )}
          </b>
          {scanner.status === 'scanning' && (
            <span className="muted">
              {rate} {tr('akun/menit', 'accounts/min')}
              {eta > 0 && tr(` · sisa ±${fmtDuration(eta)}`, ` · ETA ±${fmtDuration(eta)}`)}
              {pass.lastDurationMs > 0 &&
                tr(` · pass terakhir ${fmtDuration(pass.lastDurationMs)}`, ` · last pass ${fmtDuration(pass.lastDurationMs)}`)}
            </span>
          )}
          {seed && (
            <span
              className="tag"
              style={{ whiteSpace: 'normal' }}
              title={tr('Sumber daftar akun yang dipindai', 'Source of the scanned account list')}
            >
              {fmtCount(seed.count)} {tr('akun leaderboard', 'leaderboard accounts')} ·{' '}
              {mode.demo ? tr('simulasi', 'simulated') : sourceLabel()[seed.source]}
              {seed.generatedAt ? ` · ${fmtAgo(seed.generatedAt)}` : ''}
            </span>
          )}
          <span className="tag">
            {scanner.discovered.size} {tr('dari live feed', 'from live feed')}
          </span>
          {scanner.errors > 0 && (
            <span className="tag warn">
              {scanner.errors} {tr('error', 'errors')}
            </span>
          )}
        </div>
        <div className="row">
          {scanner.isRunning ? (
            <button type="button" className="btn sm" onClick={() => scanner.pause()}>
              {tr('Jeda', 'Pause')}
            </button>
          ) : (
            <button type="button" className="btn sm primary" onClick={() => void scanner.start()}>
              {tr('Lanjutkan', 'Resume')}
            </button>
          )}
          <button
            type="button"
            className="btn sm"
            onClick={() => scanner.restartPass()}
            title={tr('Mulai ulang dari akun terbesar', 'Restart from the largest accounts')}
          >
            {tr('Pass baru', 'New pass')}
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={scanner.status === 'seeding'}
            onClick={() => void scanner.loadSeed(true)}
            title={tr(
              'Unduh ulang leaderboard terbaru langsung dari Hyperliquid',
              'Re-download the latest leaderboard straight from Hyperliquid',
            )}
          >
            {tr('Leaderboard terbaru', 'Latest leaderboard')}
          </button>
        </div>
      </div>
      <Progress value={progress} />
      {scanner.statusMsg && <div className="small muted" style={{ marginTop: 8 }}>{scanner.statusMsg}</div>}
      {scanner.restoredAt > 0 && pass.n <= 1 && progress < 1 && (
        <div className="small dim" style={{ marginTop: 6 }}>
          {tr(
            <>Menampilkan hasil scan sebelumnya ({fmtAgo(scanner.restoredAt)}) sambil diperbarui.</>,
            <>Showing previous scan results ({fmtAgo(scanner.restoredAt)}) while updating.</>,
          )}
        </div>
      )}
    </section>
  );
}
