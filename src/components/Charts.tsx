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
import { fmtPx, fmtUsd, num } from '../lib/format';
import { useObservable } from '../lib/observable';
import { chartPalette, theme } from '../lib/theme';
import { Seg, Spinner } from './ui';

type Palette = ReturnType<typeof chartPalette>;

// Explicit formatters: the id-ID locale writes times as "14.10", which reads
// like a date on a time axis. Times are shown in the viewer's local timezone.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
const pad = (n: number) => String(n).padStart(2, '0');
const toDate = (t: Time) => new Date((t as number) * 1000);
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function tickMark(t: Time, type: TickMarkType): string {
  const d = toDate(t);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return MONTHS[d.getMonth()];
    case TickMarkType.DayOfMonth:
      return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    default:
      return hhmm(d);
  }
}

/** The theme-dependent part of the chart options (re-applied when the theme changes). */
function themeOptions(p: Palette) {
  return {
    layout: { background: { type: ColorType.Solid, color: p.bg }, textColor: p.text },
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

function baseChart(el: HTMLElement, priceFormatter: (p: number) => string, p: Palette): IChartApi {
  const t = themeOptions(p);
  return createChart(el, {
    autoSize: true,
    layout: { ...t.layout, fontSize: 11, fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace" },
    grid: t.grid,
    rightPriceScale: t.rightPriceScale,
    timeScale: { ...t.timeScale, timeVisible: true, secondsVisible: false, tickMarkFormatter: tickMark },
    crosshair: { mode: CrosshairMode.Normal, ...t.crosshair },
    localization: {
      priceFormatter,
      timeFormatter: (t: Time) => {
        const d = toDate(t);
        return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${hhmm(d)}`;
      },
    },
  });
}

export type Interval = '15m' | '1h' | '4h' | '1d';
const INTERVAL_MS: Record<Interval, number> = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000, '1d': 86_400_000 };
const LOOKBACK_BARS = 400;

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

/** Candles for a coin with optional horizontal levels (entries, liquidations) and fill markers. */
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
  const [interval, setIv] = useState<Interval>(defaultInterval);
  const [state, setState] = useState<{ loading: boolean; error: string; bars: number }>({ loading: true, error: '', bars: 0 });
  const tv = useObservable(theme);

  useEffect(() => {
    if (!box.current) return;
    const p = chartPalette();
    const c = baseChart(box.current, fmtPx, p);
    const s = c.addSeries(CandlestickSeries, candleOptions(p));
    chart.current = c;
    series.current = s;
    markerApi.current = createSeriesMarkers(s, []);
    return () => {
      c.remove();
      chart.current = null;
      series.current = null;
      markerApi.current = null;
      priceLines.current = [];
    };
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    const end = Date.now();
    const start = end - INTERVAL_MS[interval] * LOOKBACK_BARS;
    setState((s) => ({ ...s, loading: true, error: '' }));
    getCandles(coin, interval, start, end, ctl.signal)
      .then((candles) => {
        if (ctl.signal.aborted || !series.current) return;
        series.current.setData(
          candles.map((k) => ({
            time: Math.floor(k.t / 1000) as UTCTimestamp,
            open: num(k.o),
            high: num(k.h),
            low: num(k.l),
            close: num(k.c),
          })),
        );
        chart.current?.timeScale().fitContent();
        setState({ loading: false, error: '', bars: candles.length });
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setState({ loading: false, error: e.message, bars: 0 });
      });
    return () => ctl.abort();
  }, [coin, interval]);

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
  const markersKey = `${interval}|${state.bars}|${markers.length}|${markers[0]?.time ?? 0}|${tv}`;
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

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>{coin}-PERP</b>
        <Seg<Interval>
          value={interval}
          onChange={setIv}
          options={(['15m', '1h', '4h', '1d'] as Interval[]).map((v) => ({ value: v, label: v }))}
        />
      </div>
      <div className={`chart-box${small ? ' sm' : ''}`}>
        <div ref={box} style={{ position: 'absolute', inset: 0 }} />
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
    const c = baseChart(box.current, (v) => fmtUsd(v), p);
    const points = new Map<number, number>();
    for (const [t, v] of data) points.set(Math.floor(t / 1000), num(v));
    const series = [...points].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value }));
    if (mode === 'equity') {
      c.addSeries(AreaSeries, {
        lineColor: p.amber,
        topColor: p.areaTop,
        bottomColor: p.areaBottom,
        lineWidth: 2,
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
      }).setData(series);
    }
    c.timeScale().fitContent();
    return () => c.remove();
  }, [data, mode, tv]);
  return (
    <div className="chart-box sm">
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      {!data.length && <div className="chart-overlay">Belum ada riwayat</div>}
    </div>
  );
}
