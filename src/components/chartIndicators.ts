import {
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type LineWidth,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { fmtPx, fmtSize } from '../lib/format';
import { tr } from '../lib/i18n';
import {
  adx,
  atr,
  bollinger,
  cci,
  ichimoku,
  ma,
  macd,
  obv,
  pick,
  psar,
  rsi,
  sma,
  stoch,
  stochRsi,
  supertrend,
  vwap,
  type Anchor,
  type Bar,
  type Line,
  type MaType,
  type Source,
} from '../lib/indicators';
import { INDICATORS, type IndicatorSettings } from '../lib/indicatorSettings';

/** One value shown in a chart legend. */
export interface Plot {
  label: string;
  color: string;
  at: (time: number) => number | null;
  fmt: (v: number) => string;
}

/** Legend group: the price chart (pane 0) or one lower panel. */
export interface LegendGroup {
  pane: number;
  title: string;
  plots: Plot[];
}

export interface IndicatorLayer {
  series: ISeriesApi<SeriesType>[];
  groups: LegendGroup[];
  /** Number of panels added below the price chart. */
  panes: number;
}

/** Compact number for oscillator values whose scale depends on the coin (MACD, ATR, OBV). */
export function fmtNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(3);
  if (a === 0) return '0';
  return v.toPrecision(3);
}
const fmt2 = (v: number) => v.toFixed(2);

const custom = (formatter: (v: number) => string, minMove = 1e-9) => ({ type: 'custom' as const, formatter, minMove });
const fixedRange = (min: number, max: number) => () => ({ priceRange: { minValue: min, maxValue: max } });

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/**
 * Adds every enabled indicator to `chart` (overlays on pane 0, oscillators in
 * new panes below) and returns what was added, so the caller can remove it
 * and draw legends. `step` is the bar length in seconds, used to place the
 * Ichimoku cloud ahead of the last bar.
 */
export function addIndicators(
  chart: IChartApi,
  bars: Bar[],
  step: number,
  settings: IndicatorSettings,
  pxMinMove: number,
  levelColor: string,
): IndicatorLayer {
  const series: ISeriesApi<SeriesType>[] = [];
  const groups: LegendGroup[] = [{ pane: 0, title: '', plots: [] }];
  if (!bars.length) return { series, groups, panes: 0 };

  const last = bars[bars.length - 1].time;
  const timeAt = (i: number) => (i < bars.length ? bars[i].time : last + (i - bars.length + 1) * step);
  const index = new Map(bars.map((b, i) => [b.time, i]));

  /** Line data with `offset` bars of shift (positive = into the future), skipping leading gaps. */
  const toData = (line: Line, offset = 0) => {
    const out: ({ time: Time; value: number } | { time: Time })[] = [];
    line.forEach((v, i) => {
      const j = i + offset;
      if (j < 0) return;
      const time = timeAt(j) as UTCTimestamp;
      if (v != null) out.push({ time, value: v });
      else if (out.length) out.push({ time }); // gap inside the line
    });
    return out;
  };
  const lookup = (line: Line, offset = 0) => (time: number) => {
    const i = index.get(time);
    if (i === undefined) return null;
    return line[i - offset] ?? null;
  };

  let paneCount = 0;
  const overlayFmt = custom(fmtPx, pxMinMove);

  function addLine(pane: number, line: Line, color: string, opts: { offset?: number; width?: LineWidth; dots?: boolean; label?: boolean; format?: ReturnType<typeof custom>; autoscale?: () => { priceRange: { minValue: number; maxValue: number } } } = {}) {
    const s = chart.addSeries(
      LineSeries,
      {
        color,
        lineWidth: opts.width ?? 1,
        priceLineVisible: false,
        lastValueVisible: opts.label ?? true,
        crosshairMarkerVisible: false,
        lineVisible: !opts.dots,
        pointMarkersVisible: !!opts.dots,
        pointMarkersRadius: opts.dots ? 1.5 : undefined,
        priceFormat: opts.format ?? (pane === 0 ? overlayFmt : custom(fmtNum)),
        ...(opts.autoscale && { autoscaleInfoProvider: opts.autoscale }),
      },
      pane,
    );
    s.setData(toData(line, opts.offset));
    series.push(s);
    return s;
  }

  function levels(s: ISeriesApi<'Line'>, values: number[]) {
    for (const price of values)
      s.createPriceLine({ price, color: levelColor, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
  }

  function newPane(title: string): LegendGroup {
    const g: LegendGroup = { pane: ++paneCount, title, plots: [] };
    groups.push(g);
    return g;
  }

  /** Tighter vertical margins for the lower panels (the default leaves room for a legend at the top). */
  const fitPanes = () => {
    for (let i = 1; i <= paneCount; i++) chart.priceScale('right', i).applyOptions({ scaleMargins: { top: 0.22, bottom: 0.06 } });
  };

  const main = groups[0];

  for (const def of INDICATORS) {
    const cfg = settings[def.id];
    if (!cfg.on) continue;
    const p = cfg.p;
    const c = cfg.c;
    const n = (k: string) => Number(p[k]);
    const src = () => pick(bars, (p.src as Source) ?? 'close');
    const label = def.label(p);

    switch (def.id) {
      case 'ma1':
      case 'ma2':
      case 'ma3': {
        const line = ma(p.type as MaType, src(), n('n'));
        addLine(0, line, c.line, { width: 2 });
        main.plots.push({ label, color: c.line, at: lookup(line), fmt: fmtPx });
        break;
      }
      case 'bb': {
        const b = bollinger(src(), n('n'), n('mult'));
        addLine(0, b.upper, c.band, { label: false });
        addLine(0, b.basis, c.basis);
        addLine(0, b.lower, c.band, { label: false });
        main.plots.push(
          { label: `${label} ▲`, color: c.band, at: lookup(b.upper), fmt: fmtPx },
          { label: tr('Tengah', 'Basis'), color: c.basis, at: lookup(b.basis), fmt: fmtPx },
          { label: '▼', color: c.band, at: lookup(b.lower), fmt: fmtPx },
        );
        break;
      }
      case 'vwap': {
        const line = vwap(bars, p.anchor as Anchor);
        addLine(0, line, c.line, { width: 2 });
        main.plots.push({ label, color: c.line, at: lookup(line), fmt: fmtPx });
        break;
      }
      case 'supertrend': {
        const st = supertrend(bars, n('n'), n('mult'));
        const up = st.value.map((v, i) => (st.trend[i] === 1 ? v : null));
        const down = st.value.map((v, i) => (st.trend[i] === -1 ? v : null));
        addLine(0, up, c.up, { width: 2 });
        addLine(0, down, c.down, { width: 2 });
        main.plots.push({
          label,
          color: c.up,
          at: (t) => {
            const i = index.get(t);
            return i === undefined ? null : st.value[i];
          },
          fmt: fmtPx,
        });
        break;
      }
      case 'psar': {
        const line = psar(bars, n('start'), n('step'), n('max'));
        addLine(0, line, c.line, { dots: true, label: false });
        main.plots.push({ label, color: c.line, at: lookup(line), fmt: fmtPx });
        break;
      }
      case 'ichimoku': {
        const ich = ichimoku(bars, n('conv'), n('base'), n('spanB'), n('disp'));
        addLine(0, ich.tenkan, c.tenkan);
        addLine(0, ich.kijun, c.kijun);
        addLine(0, ich.spanA, c.spanA, { offset: ich.shift, label: false });
        addLine(0, ich.spanB, c.spanB, { offset: ich.shift, label: false });
        addLine(0, ich.chikou, c.chikou, { offset: -ich.shift, label: false });
        main.plots.push(
          { label: 'Tenkan', color: c.tenkan, at: lookup(ich.tenkan), fmt: fmtPx },
          { label: 'Kijun', color: c.kijun, at: lookup(ich.kijun), fmt: fmtPx },
          { label: 'Span A', color: c.spanA, at: lookup(ich.spanA, ich.shift), fmt: fmtPx },
          { label: 'Span B', color: c.spanB, at: lookup(ich.spanB, ich.shift), fmt: fmtPx },
        );
        break;
      }
      case 'volume': {
        const g = newPane(label);
        const s = chart.addSeries(
          HistogramSeries,
          { priceLineVisible: false, lastValueVisible: true, priceFormat: custom(fmtSize, 1e-6) },
          g.pane,
        );
        s.setData(
          bars.map((b) => ({
            time: b.time as UTCTimestamp,
            value: b.volume,
            color: withAlpha(b.close >= b.open ? c.up : c.down, 0.6),
          })),
        );
        series.push(s);
        const vol: Line = bars.map((b) => b.volume);
        g.plots.push({ label: 'Vol', color: c.up, at: lookup(vol), fmt: fmtSize });
        if (n('ma') > 0) {
          const avg = sma(vol, n('ma'));
          addLine(g.pane, avg, c.ma, { format: custom(fmtSize, 1e-6), label: false });
          g.plots.push({ label: `MA ${n('ma')}`, color: c.ma, at: lookup(avg), fmt: fmtSize });
        }
        break;
      }
      case 'rsi': {
        const g = newPane(label);
        const line = rsi(src(), n('n'));
        const s = addLine(g.pane, line, c.line, { format: custom(fmt2, 0.01), autoscale: fixedRange(0, 100) });
        levels(s as ISeriesApi<'Line'>, [n('ob'), 50, n('os')]);
        g.plots.push({ label: 'RSI', color: c.line, at: lookup(line), fmt: fmt2 });
        break;
      }
      case 'macd': {
        const g = newPane(label);
        const m = macd(src(), n('fast'), n('slow'), n('signal'));
        const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: custom(fmtNum) }, g.pane);
        h.setData(
          m.hist.flatMap((v, i) =>
            v == null ? [] : [{ time: bars[i].time as UTCTimestamp, value: v, color: withAlpha(v >= 0 ? c.up : c.down, 0.7) }],
          ),
        );
        series.push(h);
        addLine(g.pane, m.macd, c.macd);
        addLine(g.pane, m.signal, c.signal);
        g.plots.push(
          { label: 'MACD', color: c.macd, at: lookup(m.macd), fmt: fmtNum },
          { label: 'Signal', color: c.signal, at: lookup(m.signal), fmt: fmtNum },
          { label: 'Hist', color: c.up, at: lookup(m.hist), fmt: fmtNum },
        );
        break;
      }
      case 'stochrsi':
      case 'stoch': {
        const g = newPane(label);
        const s = def.id === 'stoch' ? stoch(bars, n('k'), n('smooth'), n('d')) : stochRsi(src(), n('rsi'), n('stoch'), n('k'), n('d'));
        const k = addLine(g.pane, s.k, c.k, { format: custom(fmt2, 0.01), autoscale: fixedRange(0, 100) });
        addLine(g.pane, s.d, c.d, { format: custom(fmt2, 0.01), autoscale: fixedRange(0, 100) });
        levels(k as ISeriesApi<'Line'>, [80, 20]);
        g.plots.push({ label: '%K', color: c.k, at: lookup(s.k), fmt: fmt2 }, { label: '%D', color: c.d, at: lookup(s.d), fmt: fmt2 });
        break;
      }
      case 'atr': {
        const g = newPane(label);
        const line = atr(bars, n('n'));
        addLine(g.pane, line, c.line);
        g.plots.push({ label: 'ATR', color: c.line, at: lookup(line), fmt: fmtNum });
        break;
      }
      case 'adx': {
        const g = newPane(label);
        const r = adx(bars, n('n'));
        const a = addLine(g.pane, r.adx, c.adx, { width: 2, format: custom(fmt2, 0.01) });
        addLine(g.pane, r.plus, c.plus, { format: custom(fmt2, 0.01) });
        addLine(g.pane, r.minus, c.minus, { format: custom(fmt2, 0.01) });
        levels(a as ISeriesApi<'Line'>, [25]);
        g.plots.push(
          { label: 'ADX', color: c.adx, at: lookup(r.adx), fmt: fmt2 },
          { label: '+DI', color: c.plus, at: lookup(r.plus), fmt: fmt2 },
          { label: '−DI', color: c.minus, at: lookup(r.minus), fmt: fmt2 },
        );
        break;
      }
      case 'obv': {
        const g = newPane(label);
        const line = obv(bars);
        addLine(g.pane, line, c.line, { format: custom(fmtNum, 1e-6) });
        g.plots.push({ label: 'OBV', color: c.line, at: lookup(line), fmt: fmtNum });
        break;
      }
      case 'cci': {
        const g = newPane(label);
        const line = cci(bars, n('n'));
        const s = addLine(g.pane, line, c.line, { format: custom(fmt2, 0.01) });
        levels(s as ISeriesApi<'Line'>, [100, 0, -100]);
        g.plots.push({ label: 'CCI', color: c.line, at: lookup(line), fmt: fmt2 });
        break;
      }
    }
  }
  fitPanes();
  return { series, groups, panes: paneCount };
}

/** Removes a layer added by addIndicators, including its panes. */
export function removeIndicators(chart: IChartApi, layer: IndicatorLayer | null): void {
  if (!layer) return;
  for (const s of layer.series) {
    try {
      chart.removeSeries(s);
    } catch {
      /* already gone */
    }
  }
  for (let i = chart.panes().length - 1; i > 0; i--) chart.removePane(i);
}
