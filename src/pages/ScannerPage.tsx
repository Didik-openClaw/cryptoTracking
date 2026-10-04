import { useMemo, useState } from 'react';
import { Addr } from '../components/Addr';
import { PositionsTable } from '../components/PositionsTable';
import { Empty, LongShortBar, Progress, Seg, StatCard, UsdSelect } from '../components/ui';
import { fmtAgo, fmtDuration, fmtUsd, pnlClass } from '../lib/format';
import { useWhalePositions } from '../hooks';
import { useObservable } from '../lib/observable';
import { aggregateByCoin } from '../lib/positions';
import { scanner } from '../lib/scanner';
import { settings } from '../lib/settings';
import { watchlist } from '../lib/watchlist';

type SideFilter = 'all' | 'long' | 'short';

const SOURCE_LABEL: Record<string, string> = {
  cache: 'cache browser',
  bundled: 'snapshot situs',
  direct: 'langsung dari Hyperliquid',
  stale: 'snapshot lama',
};

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
          <h1>Scanner Whale Hyperliquid</h1>
          <p>
            Semua trader dengan posisi perp ≥ <b>{fmtUsd(s.minPositionUsd, { decimals: 0 })}</b>: siapa yang LONG, siapa
            yang SHORT, berapa besar, di harga berapa masuk, dan di mana likuidasinya. Harga diperbarui real-time.
          </p>
        </div>
        <div className="row">
          <span className="muted small">Posisi minimal</span>
          <UsdSelect value={s.minPositionUsd} onChange={(v) => settings.update({ minPositionUsd: v })} />
        </div>
      </div>

      <ScanStatus progress={progress} eta={eta} rate={rate} />

      <div className="cards">
        <StatCard
          label="Posisi jumbo"
          value={filtered.length.toLocaleString('id-ID')}
          sub={`${totals.wallets} wallet · total ${fmtUsd(total)}`}
        />
        <StatCard
          label="Total LONG whale"
          tone="long"
          value={<span className="pos">{fmtUsd(totals.longUsd)}</span>}
          sub={
            <>
              {totals.longN} posisi · uPnL <span className={pnlClass(totals.longPnl)}>{fmtUsd(totals.longPnl, { sign: true })}</span>
            </>
          }
          onClick={() => setSide('long')}
        />
        <StatCard
          label="Total SHORT whale"
          tone="short"
          value={<span className="neg">{fmtUsd(totals.shortUsd)}</span>}
          sub={
            <>
              {totals.shortN} posisi · uPnL <span className={pnlClass(totals.shortPnl)}>{fmtUsd(totals.shortPnl, { sign: true })}</span>
            </>
          }
          onClick={() => setSide('short')}
        />
        <StatCard
          label="Rasio Long / Short"
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
          label="Dekat likuidasi (< 5%)"
          tone={totals.nearLiq ? 'danger' : undefined}
          value={<span className={totals.nearLiq ? 'danger' : ''}>{totals.nearLiq}</span>}
          sub="Klik untuk lihat posisi yang paling terancam"
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
              Lihat semua coin →
            </a>
          </div>
          {byCoin.length ? (
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Coin</th>
                    <th className="num">Long</th>
                    <th style={{ width: '32%' }}>Rasio</th>
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
            <Empty>Menunggu hasil scan…</Empty>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Whale Terbesar (total eksposur)</h2>
            <span className="hint">Net bias: hijau = net long, merah = net short</span>
          </div>
          {topWallets.length ? (
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th className="num">Eksposur</th>
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
            <Empty>Menunggu hasil scan…</Empty>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Semua Posisi Jumbo</h2>
          <span className="hint">Klik judul kolom untuk mengurutkan · ☆ untuk pantau &amp; dapat alert</span>
        </div>
        <div className="filters" style={{ marginBottom: 12 }}>
          <label className="field">
            <span>Coin</span>
            <select className="input" value={coin} onChange={(e) => setCoin(e.target.value)}>
              <option value="all">Semua coin</option>
              {coins.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Sisi</span>
            <Seg<SideFilter>
              value={side}
              onChange={setSide}
              options={[
                { value: 'all', label: 'Semua' },
                { value: 'long', label: 'Long', cls: 'long' },
                { value: 'short', label: 'Short', cls: 'short' },
              ]}
            />
          </div>
          <label className="field">
            <span>Leverage min</span>
            <select className="input" value={minLev} onChange={(e) => setMinLev(Number(e.target.value))}>
              {[0, 2, 5, 10, 20, 25, 40].map((v) => (
                <option key={v} value={v}>
                  {v ? `≥ ${v}x` : 'Semua'}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Jarak likuidasi</span>
            <select className="input" value={maxDist} onChange={(e) => setMaxDist(Number(e.target.value))}>
              {[0, 0.02, 0.05, 0.1, 0.2].map((v) => (
                <option key={v} value={v}>
                  {v ? `< ${v * 100}%` : 'Semua'}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow" style={{ minWidth: 200 }}>
            <span>Cari wallet / label</span>
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="0x… atau nama" />
          </label>
          <label className="check" style={{ paddingBottom: 8 }}>
            <input type="checkbox" checked={onlyWatch} onChange={(e) => setOnlyWatch(e.target.checked)} />
            Hanya watchlist
          </label>
          <button type="button" className="btn ghost" onClick={resetFilters}>
            Reset filter
          </button>
        </div>
        <PositionsTable
          key={sortKey}
          rows={filtered}
          initialSort={sortKey}
          emptyText={
            all.length ? (
              'Tidak ada posisi yang cocok dengan filter.'
            ) : (
              <>
                <b>Scanner sedang berjalan.</b>
                <br />
                Posisi ≥ {fmtUsd(s.minPositionUsd)} akan muncul di sini begitu ditemukan. Akun terbesar dipindai lebih dulu.
              </>
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
    <section className="panel" style={{ padding: '12px 16px' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="row small">
          <b>
            {scanner.status === 'seeding'
              ? 'Memuat daftar akun…'
              : scanner.status === 'paused'
                ? 'Scanner dijeda'
                : `Pass #${pass.n}: ${pass.done.toLocaleString('id-ID')} / ${pass.total.toLocaleString('id-ID')} akun`}
          </b>
          {scanner.status === 'scanning' && (
            <span className="muted">
              {rate} akun/menit{eta > 0 && ` · sisa ±${fmtDuration(eta)}`}
              {pass.lastDurationMs > 0 && ` · pass terakhir ${fmtDuration(pass.lastDurationMs)}`}
            </span>
          )}
          {seed && (
            <span className="tag" style={{ whiteSpace: 'normal' }} title="Sumber daftar akun yang dipindai">
              {seed.count.toLocaleString('id-ID')} akun leaderboard · {SOURCE_LABEL[seed.source]}
              {seed.generatedAt ? ` · ${fmtAgo(seed.generatedAt)}` : ''}
            </span>
          )}
          <span className="tag">{scanner.discovered.size} dari live feed</span>
          {scanner.errors > 0 && <span className="tag warn">{scanner.errors} error</span>}
        </div>
        <div className="row">
          {scanner.isRunning ? (
            <button type="button" className="btn sm" onClick={() => scanner.pause()}>
              ⏸ Jeda
            </button>
          ) : (
            <button type="button" className="btn sm primary" onClick={() => void scanner.start()}>
              ▶ Lanjutkan
            </button>
          )}
          <button type="button" className="btn sm" onClick={() => scanner.restartPass()} title="Mulai ulang dari akun terbesar">
            ↻ Pass baru
          </button>
          <button
            type="button"
            className="btn sm"
            disabled={scanner.status === 'seeding'}
            onClick={() => void scanner.loadSeed(true)}
            title="Unduh ulang leaderboard terbaru langsung dari Hyperliquid"
          >
            ⇣ Leaderboard terbaru
          </button>
        </div>
      </div>
      <Progress value={progress} />
      {scanner.statusMsg && <div className="small muted" style={{ marginTop: 8 }}>{scanner.statusMsg}</div>}
      {scanner.restoredAt > 0 && pass.n <= 1 && progress < 1 && (
        <div className="small dim" style={{ marginTop: 6 }}>
          Menampilkan hasil scan sebelumnya ({fmtAgo(scanner.restoredAt)}) sambil diperbarui.
        </div>
      )}
    </section>
  );
}
