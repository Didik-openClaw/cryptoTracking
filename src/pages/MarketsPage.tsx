import { useEffect, useMemo, useState } from 'react';
import { Empty, Seg, StatCard, useSort } from '../components/ui';
import { Priority } from '../lib/api';
import { csvFilename, downloadCsv } from '../lib/csv';
import { fmtAgo, fmtPct, fmtPx, fmtUsd, pnlClass } from '../lib/format';
import { absSpread, arbHint, fetchPredictedFundings, VENUE_LABELS, type FundingCompareRow, type VenueFunding } from '../lib/fundingCompare';
import { tr } from '../lib/i18n';
import { market } from '../lib/market';
import { EXTREME_APR, filterRows, heat, screenRows, summarize, type QuickFilter, type ScreenRow } from '../lib/marketScreen';
import { useObservable } from '../lib/observable';

type Col = 'coin' | 'mark' | 'change' | 'volume' | 'oi' | 'oiVol' | 'funding' | 'basis' | 'lev';
const getters: Record<Col, (r: ScreenRow) => number | string> = {
  coin: (r) => r.coin,
  mark: (r) => r.mark,
  change: (r) => r.change,
  volume: (r) => r.volume,
  oi: (r) => r.oiUsd,
  oiVol: (r) => r.oiVol,
  funding: (r) => r.funding,
  basis: (r) => r.basis,
  lev: (r) => r.maxLeverage,
};

type ArbCol = 'coin' | 'hl' | 'bin' | 'bybit' | 'spread';
const arbGetters: Record<ArbCol, (r: FundingCompareRow) => number | string> = {
  coin: (r) => r.coin,
  hl: (r) => r.hl?.apr ?? NaN,
  bin: (r) => r.bin?.apr ?? NaN,
  bybit: (r) => r.bybit?.apr ?? NaN,
  spread: absSpread,
};

const aprText = (v: number) => fmtPct(v, { decimals: 1, sign: true });
/** Tint a cell green/red with an intensity that saturates at `full`. */
const tint = (v: number, full: number) => {
  const a = heat(v, full) * 0.28;
  return a ? { background: v > 0 ? `rgba(35, 209, 96, ${a})` : `rgba(255, 66, 66, ${a})` } : undefined;
};

function VenueCell({ v }: { v: VenueFunding | null }) {
  if (!v) return <td className="num dim">–</td>;
  return (
    <td className={`num ${pnlClass(v.apr)}`} title={`${fmtPct(v.rate, { decimals: 4 })} / ${v.intervalHours}h`}>
      {aprText(v.apr)}
    </td>
  );
}

function FundingArb() {
  const [rows, setRows] = useState<FundingCompareRow[]>([]);
  const [state, setState] = useState({ loading: true, error: '', at: 0 });
  useEffect(() => {
    const ctl = new AbortController();
    let first = true;
    const load = () =>
      fetchPredictedFundings(first ? Priority.User : Priority.Watch, ctl.signal)
        .then((r) => {
          first = false;
          setRows(r);
          setState({ loading: false, error: '', at: Date.now() });
        })
        .catch((e: Error) => e.name !== 'AbortError' && setState((s) => ({ ...s, loading: false, error: e.message })));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      ctl.abort();
      clearInterval(t);
    };
  }, []);
  const { sorted, th } = useSort(rows, arbGetters, 'spread');

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{tr('Funding antar-exchange (arbitrase)', 'Cross-exchange funding (arbitrage)')}</h2>
        <span className="hint">
          {state.at ? tr(`prediksi funding berikutnya · ${fmtAgo(state.at)}`, `next predicted funding · ${fmtAgo(state.at)}`) : ''}
        </span>
      </div>
      {state.error && <p className="danger small">{state.error}</p>}
      {sorted.length ? (
        <div className="table-wrap" style={{ maxHeight: 520 }}>
          <table>
            <thead>
              <tr>
                {th('coin', 'Coin')}
                {th('hl', 'Hyperliquid APR', { num: true })}
                {th('bin', 'Binance APR', { num: true })}
                {th('bybit', 'Bybit APR', { num: true })}
                {th('spread', tr('Selisih terbesar', 'Largest spread'), {
                  num: true,
                  title: tr('APR Hyperliquid dikurangi APR exchange lain', 'Hyperliquid APR minus the other venue’s APR'),
                })}
                <th>{tr('Posisi (sebelum fee)', 'Trade (before fees)')}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 120).map((r) => {
                const hint = arbHint(r);
                return (
                  <tr key={r.coin}>
                    <td>
                      <a className="coin" href={`#/coin/${encodeURIComponent(r.coin)}`}>
                        {r.coin}
                      </a>
                    </td>
                    <VenueCell v={r.hl} />
                    <VenueCell v={r.bin} />
                    <VenueCell v={r.bybit} />
                    <td className="num" style={r.best ? tint(r.best.spread, 1) : undefined}>
                      {r.best ? (
                        <>
                          {aprText(r.best.spread)} <span className="dim small">vs {VENUE_LABELS[r.best.venue]}</span>
                        </>
                      ) : (
                        <span className="dim">–</span>
                      )}
                    </td>
                    <td className="small">
                      {hint ? (
                        <>
                          <span className="pos">Long {VENUE_LABELS[hint.long]}</span> / <span className="neg">Short {VENUE_LABELS[hint.short]}</span>{' '}
                          <span className="dim">≈ {fmtPct(hint.spreadApr, { decimals: 1 })}/{tr('thn', 'yr')}</span>
                        </>
                      ) : (
                        <span className="dim">–</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : state.loading ? (
        <Empty>{tr('Memuat funding Binance & Bybit…', 'Loading Binance & Bybit funding…')}</Empty>
      ) : (
        <Empty>{tr('Data perbandingan funding belum tersedia.', 'Funding comparison not available.')}</Empty>
      )}
      <p className="dim small" style={{ marginTop: 6 }}>
        {tr(
          'Semua rate diubah ke APR (Hyperliquid per jam, Binance/Bybit biasanya per 8 jam). Saran posisi mengambil sisi yang menerima funding di kedua exchange; belum termasuk fee, slippage, dan risiko harga/basis.',
          'All rates are converted to APR (Hyperliquid hourly, Binance/Bybit usually every 8h). The trade hint takes the funding-receiving side on both venues; fees, slippage and price/basis risk are not included.',
        )}
      </p>
    </section>
  );
}

export function MarketsPage() {
  const mv = useObservable(market);
  const [filter, setFilter] = useState<QuickFilter>('all');
  const [q, setQ] = useState('');
  const rows = useMemo(() => screenRows(market.coins.values(), market.mids), [mv]);
  const sum = useMemo(() => summarize(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, filter, q), [rows, filter, q]);
  const { sorted, th } = useSort(shown, getters, 'volume');

  const exportCsv = () =>
    downloadCsv(
      csvFilename('dty-markets'),
      ['coin', 'price', 'change_24h', 'volume_24h_usd', 'open_interest_usd', 'oi_volume_ratio', 'funding_hourly', 'funding_apr', 'basis', 'max_leverage'],
      sorted.map((r) => [r.coin, r.mark, r.change, r.volume, r.oiUsd, r.oiVol, r.funding, r.apr, r.basis, r.maxLeverage]),
    );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            <span className="fn">MRKT</span>
            {tr('Market, Funding & Open Interest', 'Markets, Funding & Open Interest')}
          </h1>
          <p>
            {tr(
              'Semua perp Hyperliquid dalam satu layar: harga, volume, open interest, funding, dan basis; plus perbandingan funding dengan Binance dan Bybit.',
              'Every Hyperliquid perp on one screen: price, volume, open interest, funding and basis; plus funding compared with Binance and Bybit.',
            )}
          </p>
        </div>
      </div>

      <div className="cards">
        <StatCard label={tr('Total open interest', 'Total open interest')} value={fmtUsd(sum.totalOi)} sub={tr(`${sum.count} perp aktif`, `${sum.count} active perps`)} />
        <StatCard label={tr('Volume 24 jam', '24h volume')} value={fmtUsd(sum.totalVolume)} sub={`OI / vol ${sum.totalVolume ? (sum.totalOi / sum.totalVolume).toFixed(2) : '–'}×`} />
        <StatCard
          label={tr('Funding rata-rata (bobot OI)', 'Avg funding (OI-weighted)')}
          value={<span className={pnlClass(sum.oiWeightedFunding)}>{aprText(sum.oiWeightedFunding * 24 * 365)}</span>}
          sub={tr(
            `median ${aprText(sum.medianFunding * 24 * 365)} APR · ${sum.positive} positif / ${sum.negative} negatif`,
            `median ${aprText(sum.medianFunding * 24 * 365)} APR · ${sum.positive} positive / ${sum.negative} negative`,
          )}
        />
        <StatCard
          label={tr(`Funding ekstrem (|APR| ≥ ${EXTREME_APR * 100}%)`, `Extreme funding (|APR| ≥ ${EXTREME_APR * 100}%)`)}
          value={
            <>
              <span className="pos">{sum.extremePos}</span> / <span className="neg">{sum.extremeNeg}</span>
            </>
          }
          sub={tr('long membayar / short membayar', 'longs paying / shorts paying')}
        />
        <StatCard
          label={tr('OI terbesar', 'Largest OI')}
          value={sum.biggest ? sum.biggest.coin : '–'}
          sub={sum.biggest ? `${fmtUsd(sum.biggest.oiUsd)} · ${fmtPct(sum.totalOi ? sum.biggest.oiUsd / sum.totalOi : 0, { decimals: 1 })} ${tr('dari total', 'of total')}` : ''}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Screener semua perp', 'All-perp screener')}</h2>
          <button type="button" className="btn sm ghost" onClick={exportCsv} disabled={!sorted.length}>
            Export CSV
          </button>
        </div>
        <div className="filters" style={{ marginBottom: 8 }}>
          <label className="field">
            <span>Coin</span>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="BTC, SOL…" spellCheck={false} />
          </label>
          <label className="field">
            <span>Filter</span>
            <Seg<QuickFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: tr('Semua', 'All') },
                { value: 'pos', label: tr('Funding +', 'Funding +') },
                { value: 'neg', label: tr('Funding −', 'Funding −') },
                { value: 'top', label: 'Top 30 vol' },
              ]}
            />
          </label>
          <span className="dim small">{tr(`${sorted.length} coin`, `${sorted.length} coins`)}</span>
        </div>
        {sorted.length ? (
          <div className="table-wrap" style={{ maxHeight: 640 }}>
            <table>
              <thead>
                <tr>
                  {th('coin', 'Coin')}
                  {th('mark', tr('Harga', 'Price'), { num: true })}
                  {th('change', tr('24j', '24h'), { num: true })}
                  {th('volume', tr('Volume 24j', '24h volume'), { num: true })}
                  {th('oi', 'Open Interest', { num: true })}
                  {th('oiVol', 'OI / Vol', {
                    num: true,
                    title: tr('Open interest dibagi volume 24 jam: tinggi = posisi bertahan, rendah = banyak churn', 'Open interest ÷ 24h volume: high = positions sit, low = churn'),
                  })}
                  {th('funding', tr('Funding/jam (APR)', 'Funding/h (APR)'), { num: true })}
                  {th('basis', 'Basis', { num: true, title: tr('Mark ÷ oracle − 1', 'Mark ÷ oracle − 1') })}
                  {th('lev', 'Max lev', { num: true })}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.coin} className="clickable" onClick={() => (location.hash = `#/coin/${encodeURIComponent(r.coin)}`)}>
                    <td>
                      <span className="coin">{r.coin}</span>
                    </td>
                    <td className="num">{fmtPx(r.mark)}</td>
                    <td className={`num ${pnlClass(r.change)}`} style={tint(r.change, 0.15)}>
                      {fmtPct(r.change, { sign: true })}
                    </td>
                    <td className="num">{fmtUsd(r.volume)}</td>
                    <td className="num">{fmtUsd(r.oiUsd)}</td>
                    <td className="num muted">{Number.isFinite(r.oiVol) ? `${r.oiVol.toFixed(2)}×` : '–'}</td>
                    <td className={`num ${pnlClass(r.funding)}`} style={tint(r.apr, 1)}>
                      {fmtPct(r.funding, { decimals: 4 })} <span className="dim small">({aprText(r.apr)})</span>
                    </td>
                    <td className={`num ${pnlClass(r.basis)}`}>{Number.isFinite(r.basis) ? fmtPct(r.basis, { decimals: 3, sign: true }) : '–'}</td>
                    <td className="num muted">{r.maxLeverage}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>{market.error || tr('Memuat data pasar…', 'Loading market data…')}</Empty>
        )}
      </section>

      <FundingArb />
    </div>
  );
}
