import { useEffect, useRef, useState } from 'react';
import {
  AreaSeries,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { getCandles } from '../lib/api';
import { fmtPct, fmtPx, fmtUsd, monthName, num, pnlClass, pxDecimals } from '../lib/format';
import { tr } from '../lib/i18n';
import type { Bar } from '../lib/indicators';
import { indicators } from '../lib/indicatorSettings';
import { useObservable } from '../lib/observable';
import { chartPalette, theme } from '../lib/theme';
import { addIndicators, removeIndicators, type IndicatorLayer, type LegendGroup } from './chartIndicators';
import { IndicatorPanel } from './IndicatorPanel';
import { Seg, Spinner } from './ui';

type Palette = ReturnType<typeof chartPalette>;

// Explicit formatters: the id-ID locale writes times as "14.10", which reads
// like a date on a time axis. Times are shown in the viewer's local timezone.
const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (t: Time) => new Date((t as number) * 1000);
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function tickMark(t: Time, type: TickMarkType): string {
  const d = toDate(t);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return monthName(d.getMonth());
    case TickMarkType.DayOfMonth:
      return `${d.getDate()} ${monthName(d.getMonth())}`;
    default:
      return hhmm(d);
  }
}

/** The theme-dependent part of the chart options (re-applied when the theme changes). */
function themeOptions(p: Palette) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: p.bg },
      textColor: p.text,
      panes: { separatorColor: p.border, separatorHoverColor: p.crosshair },
    },
    grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
    rightPriceScale: { borderColor: p.border },
    timeScale: { borderColor: p.border },
    crosshair: {
      vertLine: { color: p.crosshair, labelBackgroundColor: p.amber },
      horzLine: { color: p.crosshair, labelBackgroundColor: p.amber },
    },
  };
}

const candleOptions = (p: Palette) => ({
  upColor: p.long,
  downColor: p.short,
  borderUpColor: p.long,
  borderDownColor: p.short,
  wickUpColor: p.long,
  wickDownColor: p.short,
});

/**
 * A chart with the app's look. Prices are formatted per series (priceFormat)
 * rather than chart-wide, because a chart-wide formatter would also apply to
 * indicator panels such as RSI or volume.
 */
function baseChart(el: HTMLElement, p: Palette): IChartApi {
  const t = themeOptions(p);
  return createChart(el, {
    autoSize: true,
    layout: { ...t.layout, fontSize: 11, fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace" },
    grid: t.grid,
    rightPriceScale: t.rightPriceScale,
    timeScale: { ...t.timeScale, timeVisible: true, secondsVisible: false, tickMarkFormatter: tickMark },
    crosshair: { mode: CrosshairMode.Normal, ...t.crosshair },
    localization: {
      timeFormatter: (t: Time) => {
        const d = toDate(t);
        return `${d.getDate()} ${monthName(d.getMonth())} ${d.getFullYear()} ${hhmm(d)}`;
      },
    },
  });
}

export type Interval = '5m' | '15m' | '1h' | '4h' | '1d' | '1w';
const INTERVALS: Interval[] = ['5m', '15m', '1h', '4h', '1d', '1w'];
const INTERVAL_MS: Record<Interval, number> = {
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};
// Enough history for a 200-period average with room to scroll.
const LOOKBACK_BARS = 500;
/** Height of the price pane relative to one indicator panel. */
const MAIN_STRETCH = 3.2;

export interface ChartLine {
  price: number;
  color: string;
  title: string;
  dashed?: boolean;
}

export interface ChartMarker {
  time: number; // ms
  side: 'buy' | 'sell';
  text?: string;
}

/** OHLC of the hovered (or last) candle plus the indicator values at that time. */
function Legends({ chart, bars, groups, hover }: { chart: IChartApi | null; bars: Bar[]; groups: LegendGroup[]; hover: number | null }) {
  if (!chart || !bars.length) return null;
  const i = hover === null ? bars.length - 1 : bars.findIndex((b) => b.time === hover);
  const b = bars[i < 0 ? bars.length - 1 : i];
  const prev = bars[Math.max(0, (i < 0 ? bars.length - 1 : i) - 1)];
  const chg = prev.close ? b.close / prev.close - 1 : 0;
  const t = b.time;
  const heights = chart.panes().map((p) => p.getHeight());
  const top = (pane: number) => heights.slice(0, pane).reduce((a, h) => a + h + 1, 0);
  return (
    <>
      {groups.map((g) => (
        <div key={g.pane} className="chart-legend" style={{ top: top(g.pane) + 4 }}>
          {g.pane === 0 ? (
            <div className="lg-ohlc">
              <span>O {fmtPx(b.open)}</span>
              <span>H {fmtPx(b.high)}</span>
              <span>L {fmtPx(b.low)}</span>
              <span>C {fmtPx(b.close)}</span>
              <span className={pnlClass(chg)}>{fmtPct(chg, { sign: true })}</span>
            </div>
          ) : (
            <b className="lg-title">{g.title}</b>
          )}
          {g.plots.map((p, k) => {
            const v = p.at(t);
            return (
              <span key={k} className="lg-item">
                <i style={{ background: p.color }} />
                {g.pane === 0 && `${p.label} `}
                {g.pane !== 0 && g.plots.length > 1 && `${p.label} `}
                <em style={{ color: p.color }}>{v == null ? '–' : p.fmt(v)}</em>
              </span>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** Candles for a coin with indicators, optional horizontal levels (entries, liquidations) and fill markers. */
export function PriceChart({
  coin,
  lines = [],
  markers = [],
  defaultInterval = '1h',
  small,
}: {
  coin: string;
  lines?: ChartLine[];
  markers?: ChartMarker[];
  defaultInterval?: Interval;
  small?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markerApi = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLines = useRef<IPriceLine[]>([]);
  const layer = useRef<IndicatorLayer | null>(null);
  const [interval, setIv] = useState<Interval>(defaultInterval);
  const [state, setState] = useState<{ loading: boolean; error: string }>({ loading: true, error: '' });
  const [bars, setBars] = useState<Bar[]>([]);
  const [groups, setGroups] = useState<LegendGroup[]>([]);
  const [panes, setPanes] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const tv = useObservable(theme);
  const iv = useObservable(indicators);

  useEffect(() => {
    if (!box.current) return;
    const p = chartPalette();
    const c = baseChart(box.current, p);
    const s = c.addSeries(CandlestickSeries, { ...candleOptions(p), priceFormat: { type: 'custom', formatter: fmtPx, minMove: 0.01 } });
    chart.current = c;
    series.current = s;
    markerApi.current = createSeriesMarkers(s, []);
    let frame = 0;
    c.subscribeCrosshairMove((param) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setHover(param.time === undefined ? null : (param.time as number)));
    });
    return () => {
      cancelAnimationFrame(frame);
      c.remove();
      chart.current = null;
      series.current = null;
      markerApi.current = null;
      layer.current = null;
      priceLines.current = [];
    };
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    const end = Date.now();
    const start = end - INTERVAL_MS[interval] * LOOKBACK_BARS;
    setState({ loading: true, error: '' });
    getCandles(coin, interval, start, end, ctl.signal)
      .then((candles) => {
        if (ctl.signal.aborted || !series.current) return;
        const next: Bar[] = candles.map((k) => ({
          time: Math.floor(k.t / 1000),
          open: num(k.o),
          high: num(k.h),
          low: num(k.l),
          close: num(k.c),
          volume: num(k.v),
        }));
        const lastClose = next[next.length - 1]?.close ?? 1;
        series.current.applyOptions({ priceFormat: { type: 'custom', formatter: fmtPx, minMove: 10 ** -pxDecimals(lastClose) } });
        series.current.setData(next.map((b) => ({ ...b, time: b.time as UTCTimestamp })));
        setBars(next);
        setState({ loading: false, error: '' });
        requestAnimationFrame(() => chart.current?.timeScale().fitContent());
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setState({ loading: false, error: e.message });
      });
    return () => ctl.abort();
  }, [coin, interval]);

  // Indicators: rebuilt whenever the candles, the settings or the theme change.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    removeIndicators(c, layer.current);
    const p = chartPalette();
    const lastClose = bars[bars.length - 1]?.close ?? 1;
    const l = addIndicators(c, bars, INTERVAL_MS[interval] / 1000, indicators.value, 10 ** -pxDecimals(lastClose), p.text);
    layer.current = l;
    const all = c.panes();
    all[0]?.setStretchFactor(MAIN_STRETCH);
    for (let i = 1; i < all.length; i++) all[i].setStretchFactor(1);
    setGroups(l.groups);
    setPanes(l.panes);
  }, [bars, iv, tv]);

  // Re-colour in place when the theme changes.
  useEffect(() => {
    const p = chartPalette();
    chart.current?.applyOptions(themeOptions(p));
    series.current?.applyOptions(candleOptions(p));
  }, [tv]);

  // Horizontal levels (keyed by content: callers rebuild the array every render)
  const linesKey = JSON.stringify(lines);
  useEffect(() => {
    const s = series.current;
    if (!s) return;
    for (const pl of priceLines.current) s.removePriceLine(pl);
    priceLines.current = lines
      .filter((l) => l.price > 0)
      .map((l) =>
        s.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: 1,
          lineStyle: l.dashed ? LineStyle.Dashed : LineStyle.Solid,
          axisLabelVisible: true,
          title: l.title,
        }),
      );
  }, [linesKey]);

  // Fill markers, snapped to the candle they fall in
  const markersKey = `${interval}|${bars.length}|${markers.length}|${markers[0]?.time ?? 0}|${tv}`;
  useEffect(() => {
    if (!markerApi.current) return;
    const p = chartPalette();
    const step = INTERVAL_MS[interval];
    const from = Date.now() - step * LOOKBACK_BARS;
    const ms: SeriesMarker<Time>[] = markers
      .filter((m) => m.time >= from)
      .slice(0, 400)
      .map(
        (m): SeriesMarker<Time> => ({
          time: ((Math.floor(m.time / step) * step) / 1000) as UTCTimestamp,
          position: m.side === 'buy' ? 'belowBar' : 'aboveBar',
          color: m.side === 'buy' ? p.long : p.short,
          shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown',
          text: m.text,
        }),
      )
      .sort((a, b) => (a.time as number) - (b.time as number));
    markerApi.current.setMarkers(ms);
  }, [markersKey]);

  const active = indicators.activeCount();
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row chart-tools" style={{ justifyContent: 'space-between' }}>
        <b>{coin}-PERP</b>
        <div className="row" style={{ gap: 6 }}>
          <button
            type="button"
            className={`btn sm${showPanel ? '' : ' ghost'}`}
            onClick={() => setShowPanel((v) => !v)}
            aria-expanded={showPanel}
            title={tr('Atur indikator chart', 'Configure chart indicators')}
          >
            <span aria-hidden="true">∿</span> {tr('Indikator', 'Indicators')}
            {active > 0 && <span className="ind-count">{active}</span>}
          </button>
          <Seg<Interval> value={interval} onChange={setIv} options={INTERVALS.map((v) => ({ value: v, label: v }))} />
        </div>
      </div>
      {showPanel && <IndicatorPanel onClose={() => setShowPanel(false)} />}
      <div className={`chart-box${small ? ' sm' : ''}`} style={{ '--panes': panes } as React.CSSProperties}>
        <div ref={box} style={{ position: 'absolute', inset: 0 }} />
        {!state.loading && !state.error && <Legends chart={chart.current} bars={bars} groups={groups} hover={hover} />}
        {(state.loading || state.error) && (
          <div className="chart-overlay">{state.error ? <span className="danger">{state.error}</span> : <Spinner />}</div>
        )}
      </div>
    </div>
  );
}

/** Account value (area) or PnL (baseline around zero) history from the `portfolio` endpoint. */
export function HistoryChart({ data, mode }: { data: [number, string][]; mode: 'equity' | 'pnl' }) {
  const box = useRef<HTMLDivElement>(null);
  const tv = useObservable(theme);
  useEffect(() => {
    if (!box.current) return;
    const p = chartPalette();
    const c = baseChart(box.current, p);
    const priceFormat = { type: 'custom' as const, formatter: (v: number) => fmtUsd(v), minMove: 0.01 };
    const points = new Map<number, number>();
    for (const [t, v] of data) points.set(Math.floor(t / 1000), num(v));
    const series = [...points].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    if (mode === 'equity') {
      c.addSeries(AreaSeries, {
        lineColor: p.amber,
        topColor: p.areaTop,
        bottomColor: p.areaBottom,
        lineWidth: 2,
        priceFormat,
      }).setData(series);
    } else {
      c.addSeries(BaselineSeries, {
        baseValue: { type: 'price', price: 0 },
        topLineColor: p.long,
        topFillColor1: p.longFill,
        topFillColor2: 'rgba(0,0,0,0)',
        bottomLineColor: p.short,
        bottomFillColor1: 'rgba(0,0,0,0)',
        bottomFillColor2: p.shortFill,
        lineWidth: 2,
        priceFormat,
      }).setData(series);
    }
    c.timeScale().fitContent();
    return () => c.remove();
  }, [data, mode, tv]);
  return (
    <div className="chart-box sm">
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {!data.length && <div className="chart-overlay">{tr('Belum ada riwayat', 'No history yet')}</div>}
    </div>
  );
}
