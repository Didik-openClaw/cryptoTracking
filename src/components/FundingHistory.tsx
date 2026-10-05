import { useEffect, useRef, useState } from 'react';
import { ColorType, HistogramSeries, createChart, type UTCTimestamp } from 'lightweight-charts';
import { fmtPct } from '../lib/format';
import { toApr } from '../lib/fundingCompare';
import { FUNDING_WINDOWS, loadFundingWindow, summarizeFunding, type FundingPoint, type FundingWindow } from '../lib/fundingHistory';
import { locale, tr } from '../lib/i18n';
import { useObservable } from '../lib/observable';
import { chartPalette, theme } from '../lib/theme';
import { Seg, Spinner } from './ui';

const aprPct = (v: number) => fmtPct(v, { decimals: 1, sign: true });

/** Hourly funding of a coin over 24h / 7d / 30d as APR bars, with current, average, range and cumulative cost. */
export function FundingHistory({ coin }: { coin: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState<FundingWindow>('7d');
  const [state, setState] = useState<{ points: FundingPoint[]; loading: boolean; error: string }>({ points: [], loading: true, error: '' });
  const tv = useObservable(theme);

  useEffect(() => {
    const ctl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: '' }));
    loadFundingWindow(coin, win, ctl.signal)
      .then((points) => !ctl.signal.aborted && setState({ points, loading: false, error: '' }))
      .catch((e: Error) => e.name !== 'AbortError' && setState({ points: [], loading: false, error: e.message }));
    return () => ctl.abort();
  }, [coin, win]);

  useEffect(() => {
    if (!box.current || !state.points.length) return;
    const p = chartPalette();
    const c = createChart(box.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: p.bg }, textColor: p.text, fontSize: 10, fontFamily: "'IBM Plex Mono', ui-monospace, monospace" },
      grid: { vertLines: { visible: false }, horzLines: { color: p.grid } },
      rightPriceScale: { borderColor: p.border },
      timeScale: { borderColor: p.border, timeVisible: win === '24h' },
      handleScroll: false,
      handleScale: false,
      localization: { locale: locale() },
    });
    const s = c.addSeries(HistogramSeries, {
      priceLineVisible: false,
      priceFormat: { type: 'custom', formatter: (v: number) => `${(v * 100).toFixed(1)}%`, minMove: 0.0001 },
    });
    s.setData(
      state.points.map((pt) => ({
        time: Math.floor(pt.time / 1000) as UTCTimestamp,
        value: toApr(pt.rate),
        color: pt.rate >= 0 ? p.long : p.short,
      })),
    );
    c.timeScale().fitContent();
    return () => c.remove();
  }, [state.points, tv, win]);

  const sum = summarizeFunding(state.points);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{tr(`Riwayat funding ${coin}`, `${coin} funding history`)}</h2>
        <Seg<FundingWindow> value={win} onChange={setWin} options={FUNDING_WINDOWS.map((w) => ({ value: w, label: w }))} />
      </div>
      {sum && (
        <div className="fh-stats">
          <span>
            {tr('Sekarang', 'Now')} <b className={sum.current >= 0 ? 'pos' : 'neg'}>{aprPct(sum.apr.current)}</b>
          </span>
          <span>
            {tr('Rata-rata', 'Avg')} <b>{aprPct(sum.apr.avg)}</b>
          </span>
          <span>
            {tr('Rentang', 'Range')} {aprPct(sum.apr.min)} … {aprPct(sum.apr.max)}
          </span>
          <span title={tr('Total funding yang dibayar long (atau diterima short) selama periode ini', 'Total funding paid by longs (or earned by shorts) over this window')}>
            {tr('Kumulatif', 'Cumulative')} <b className={sum.cumulative >= 0 ? 'pos' : 'neg'}>{fmtPct(sum.cumulative, { decimals: 3, sign: true })}</b>
          </span>
          <span className="dim">
            {tr('Jam positif', 'Positive hours')} {fmtPct(sum.positiveShare, { decimals: 0 })}
          </span>
        </div>
      )}
      <div className="chart-box fh-chart">
        <div ref={box} style={{ position: 'absolute', inset: 0 }} />
        {(state.loading || state.error || !state.points.length) && (
          <div className="chart-overlay">
            {state.loading ? <Spinner /> : state.error ? <span className="danger">{state.error}</span> : tr('Belum ada data', 'No data yet')}
          </div>
        )}
      </div>
      <p className="dim small" style={{ marginTop: 6 }}>
        {tr('APR = funding per jam × 24 × 365. Positif: long membayar short.', 'APR = hourly funding × 24 × 365. Positive: longs pay shorts.')}
      </p>
    </section>
  );
}
