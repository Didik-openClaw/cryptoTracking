import { tr } from './i18n';
import { Observable } from './observable';
import { load, save } from './storage';

/**
 * Chart indicator settings: which indicators are on, their parameters and
 * colours. One set for every chart in the app, kept in localStorage.
 */
export type IndicatorId =
  | 'ma1'
  | 'ma2'
  | 'ma3'
  | 'bb'
  | 'vwap'
  | 'supertrend'
  | 'psar'
  | 'ichimoku'
  | 'volume'
  | 'rsi'
  | 'macd'
  | 'stochrsi'
  | 'stoch'
  | 'atr'
  | 'adx'
  | 'obv'
  | 'cci';

export type ParamValue = number | string;

export interface IndicatorConfig {
  on: boolean;
  p: Record<string, ParamValue>;
  c: Record<string, string>;
}

export type IndicatorSettings = Record<IndicatorId, IndicatorConfig>;

export type ParamDef =
  | { kind: 'num'; key: string; label: () => string; min: number; max: number; step?: number }
  | { kind: 'choice'; key: string; label: () => string; options: { value: string; label: () => string }[] };

export interface IndicatorDef {
  id: IndicatorId;
  /** 'overlay' draws on the price chart, 'pane' in its own panel below. */
  group: 'overlay' | 'pane';
  name: () => string;
  params: ParamDef[];
  colors: { key: string; label: () => string }[];
  defaults: IndicatorConfig;
  /** Legend label from the current parameters, e.g. "EMA 20". */
  label: (p: Record<string, ParamValue>) => string;
}

const num = (key: string, label: () => string, min: number, max: number, step = 1): ParamDef => ({ kind: 'num', key, label, min, max, step });
const period = (key = 'n', min = 1, max = 500) => num(key, () => tr('Periode', 'Length'), min, max);

const SOURCE_PARAM: ParamDef = {
  kind: 'choice',
  key: 'src',
  label: () => tr('Sumber', 'Source'),
  options: [
    { value: 'close', label: () => 'Close' },
    { value: 'open', label: () => 'Open' },
    { value: 'high', label: () => 'High' },
    { value: 'low', label: () => 'Low' },
    { value: 'hl2', label: () => 'HL2' },
    { value: 'hlc3', label: () => 'HLC3' },
    { value: 'ohlc4', label: () => 'OHLC4' },
  ],
};

const MA_TYPE: ParamDef = {
  kind: 'choice',
  key: 'type',
  label: () => tr('Jenis', 'Type'),
  options: [
    { value: 'ema', label: () => 'EMA' },
    { value: 'sma', label: () => 'SMA' },
    { value: 'wma', label: () => 'WMA' },
  ],
};

const colorLabel = {
  line: () => tr('Garis', 'Line'),
  up: () => tr('Naik', 'Up'),
  down: () => tr('Turun', 'Down'),
  signal: () => 'Signal',
};

const srcSuffix = (p: Record<string, ParamValue>) => (p.src && p.src !== 'close' ? ` ${String(p.src).toUpperCase()}` : '');

function movingAverage(id: 'ma1' | 'ma2' | 'ma3', n: number, type: string, color: string, on: boolean): IndicatorDef {
  const i = id.slice(2);
  return {
    id,
    group: 'overlay',
    name: () => `Moving Average ${i}`,
    params: [MA_TYPE, period('n', 1, 1000), SOURCE_PARAM],
    colors: [{ key: 'line', label: colorLabel.line }],
    defaults: { on, p: { type, n, src: 'close' }, c: { line: color } },
    label: (p) => `${String(p.type).toUpperCase()} ${p.n}${srcSuffix(p)}`,
  };
}

export const INDICATORS: IndicatorDef[] = [
  movingAverage('ma1', 20, 'ema', '#2962ff', true),
  movingAverage('ma2', 50, 'ema', '#ff9800', true),
  movingAverage('ma3', 200, 'sma', '#ab47bc', false),
  {
    id: 'bb',
    group: 'overlay',
    name: () => 'Bollinger Bands',
    params: [period('n', 2, 500), num('mult', () => tr('Deviasi', 'StdDev'), 0.5, 5, 0.1), SOURCE_PARAM],
    colors: [
      { key: 'basis', label: () => tr('Tengah', 'Basis') },
      { key: 'band', label: () => 'Band' },
    ],
    defaults: { on: false, p: { n: 20, mult: 2, src: 'close' }, c: { basis: '#ff6d00', band: '#26a69a' } },
    label: (p) => `BB ${p.n} ${p.mult}${srcSuffix(p)}`,
  },
  {
    id: 'vwap',
    group: 'overlay',
    name: () => 'VWAP',
    params: [
      {
        kind: 'choice',
        key: 'anchor',
        label: () => tr('Reset', 'Anchor'),
        options: [
          { value: 'day', label: () => tr('Harian', 'Daily') },
          { value: 'week', label: () => tr('Mingguan', 'Weekly') },
          { value: 'month', label: () => tr('Bulanan', 'Monthly') },
        ],
      },
    ],
    colors: [{ key: 'line', label: colorLabel.line }],
    defaults: { on: false, p: { anchor: 'day' }, c: { line: '#00acc1' } },
    label: (p) => `VWAP ${p.anchor === 'week' ? 'W' : p.anchor === 'month' ? 'M' : 'D'}`,
  },
  {
    id: 'supertrend',
    group: 'overlay',
    name: () => 'Supertrend',
    params: [num('n', () => tr('Periode ATR', 'ATR length'), 1, 200), num('mult', () => tr('Pengali', 'Factor'), 0.5, 10, 0.1)],
    colors: [
      { key: 'up', label: colorLabel.up },
      { key: 'down', label: colorLabel.down },
    ],
    defaults: { on: false, p: { n: 10, mult: 3 }, c: { up: '#26a69a', down: '#ef5350' } },
    label: (p) => `Supertrend ${p.n} ${p.mult}`,
  },
  {
    id: 'psar',
    group: 'overlay',
    name: () => 'Parabolic SAR',
    params: [
      num('start', () => 'Start', 0.001, 0.5, 0.001),
      num('step', () => tr('Kenaikan', 'Increment'), 0.001, 0.5, 0.001),
      num('max', () => 'Max', 0.01, 1, 0.01),
    ],
    colors: [{ key: 'line', label: () => tr('Titik', 'Dots') }],
    defaults: { on: false, p: { start: 0.02, step: 0.02, max: 0.2 }, c: { line: '#7e57c2' } },
    label: (p) => `SAR ${p.start} ${p.step} ${p.max}`,
  },
  {
    id: 'ichimoku',
    group: 'overlay',
    name: () => 'Ichimoku Cloud',
    params: [
      num('conv', () => 'Tenkan', 1, 200),
      num('base', () => 'Kijun', 1, 200),
      num('spanB', () => 'Senkou B', 1, 300),
      num('disp', () => tr('Geser', 'Displacement'), 1, 200),
    ],
    colors: [
      { key: 'tenkan', label: () => 'Tenkan' },
      { key: 'kijun', label: () => 'Kijun' },
      { key: 'spanA', label: () => 'Span A' },
      { key: 'spanB', label: () => 'Span B' },
      { key: 'chikou', label: () => 'Chikou' },
    ],
    defaults: {
      on: false,
      p: { conv: 9, base: 26, spanB: 52, disp: 26 },
      c: { tenkan: '#2962ff', kijun: '#b71c1c', spanA: '#43a047', spanB: '#e53935', chikou: '#9c27b0' },
    },
    label: (p) => `Ichimoku ${p.conv} ${p.base} ${p.spanB} ${p.disp}`,
  },
  {
    id: 'volume',
    group: 'pane',
    name: () => 'Volume',
    params: [num('ma', () => tr('MA volume (0 = mati)', 'Volume MA (0 = off)'), 0, 500)],
    colors: [
      { key: 'up', label: colorLabel.up },
      { key: 'down', label: colorLabel.down },
      { key: 'ma', label: () => 'MA' },
    ],
    defaults: { on: true, p: { ma: 20 }, c: { up: '#26a69a', down: '#ef5350', ma: '#ff9800' } },
    label: (p) => (Number(p.ma) > 0 ? `Vol · MA ${p.ma}` : 'Vol'),
  },
  {
    id: 'rsi',
    group: 'pane',
    name: () => 'RSI',
    params: [
      period('n', 2, 200),
      SOURCE_PARAM,
      num('ob', () => 'Overbought', 50, 100),
      num('os', () => 'Oversold', 0, 50),
    ],
    colors: [{ key: 'line', label: colorLabel.line }],
    defaults: { on: false, p: { n: 14, src: 'close', ob: 70, os: 30 }, c: { line: '#7e57c2' } },
    label: (p) => `RSI ${p.n}${srcSuffix(p)}`,
  },
  {
    id: 'macd',
    group: 'pane',
    name: () => 'MACD',
    params: [
      num('fast', () => 'Fast', 1, 200),
      num('slow', () => 'Slow', 2, 300),
      num('signal', () => 'Signal', 1, 100),
      SOURCE_PARAM,
    ],
    colors: [
      { key: 'macd', label: () => 'MACD' },
      { key: 'signal', label: colorLabel.signal },
      { key: 'up', label: () => tr('Histogram naik', 'Histogram up') },
      { key: 'down', label: () => tr('Histogram turun', 'Histogram down') },
    ],
    defaults: {
      on: false,
      p: { fast: 12, slow: 26, signal: 9, src: 'close' },
      c: { macd: '#2962ff', signal: '#ff6d00', up: '#26a69a', down: '#ef5350' },
    },
    label: (p) => `MACD ${p.fast} ${p.slow} ${p.signal}${srcSuffix(p)}`,
  },
  {
    id: 'stochrsi',
    group: 'pane',
    name: () => 'Stochastic RSI',
    params: [
      num('rsi', () => tr('Periode RSI', 'RSI length'), 2, 200),
      num('stoch', () => tr('Periode Stoch', 'Stoch length'), 2, 200),
      num('k', () => 'K', 1, 50),
      num('d', () => 'D', 1, 50),
      SOURCE_PARAM,
    ],
    colors: [
      { key: 'k', label: () => '%K' },
      { key: 'd', label: () => '%D' },
    ],
    defaults: { on: false, p: { rsi: 14, stoch: 14, k: 3, d: 3, src: 'close' }, c: { k: '#2962ff', d: '#ff6d00' } },
    label: (p) => `Stoch RSI ${p.k} ${p.d} ${p.rsi} ${p.stoch}`,
  },
  {
    id: 'stoch',
    group: 'pane',
    name: () => 'Stochastic',
    params: [num('k', () => '%K', 1, 200), num('smooth', () => tr('Penghalus K', 'K smoothing'), 1, 50), num('d', () => '%D', 1, 50)],
    colors: [
      { key: 'k', label: () => '%K' },
      { key: 'd', label: () => '%D' },
    ],
    defaults: { on: false, p: { k: 14, smooth: 1, d: 3 }, c: { k: '#2962ff', d: '#ff6d00' } },
    label: (p) => `Stoch ${p.k} ${p.smooth} ${p.d}`,
  },
  {
    id: 'atr',
    group: 'pane',
    name: () => 'ATR',
    params: [period('n', 1, 200)],
    colors: [{ key: 'line', label: colorLabel.line }],
    defaults: { on: false, p: { n: 14 }, c: { line: '#e53935' } },
    label: (p) => `ATR ${p.n}`,
  },
  {
    id: 'adx',
    group: 'pane',
    name: () => 'ADX / DMI',
    params: [period('n', 2, 200)],
    colors: [
      { key: 'adx', label: () => 'ADX' },
      { key: 'plus', label: () => '+DI' },
      { key: 'minus', label: () => '−DI' },
    ],
    defaults: { on: false, p: { n: 14 }, c: { adx: '#ff9800', plus: '#26a69a', minus: '#ef5350' } },
    label: (p) => `ADX ${p.n}`,
  },
  {
    id: 'obv',
    group: 'pane',
    name: () => 'On-Balance Volume',
    params: [],
    colors: [{ key: 'line', label: colorLabel.line }],
    defaults: { on: false, p: {}, c: { line: '#2962ff' } },
    label: () => 'OBV',
  },
  {
    id: 'cci',
    group: 'pane',
    name: () => 'CCI',
    params: [period('n', 2, 200)],
    colors: [{ key: 'line', label: colorLabel.line }],
    defaults: { on: false, p: { n: 20 }, c: { line: '#00897b' } },
    label: (p) => `CCI ${p.n}`,
  },
];

export const INDICATOR_BY_ID = Object.fromEntries(INDICATORS.map((d) => [d.id, d])) as Record<IndicatorId, IndicatorDef>;

const isColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Saved settings merged over the defaults, with unknown keys dropped and numbers clamped. */
export function normalize(saved: unknown): IndicatorSettings {
  const src = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<string, Partial<IndicatorConfig>>>;
  const out = {} as IndicatorSettings;
  for (const def of INDICATORS) {
    const s = src[def.id] ?? {};
    const p: Record<string, ParamValue> = { ...def.defaults.p };
    for (const param of def.params) {
      const v = s.p?.[param.key];
      if (param.kind === 'num' && typeof v === 'number' && Number.isFinite(v)) p[param.key] = Math.min(param.max, Math.max(param.min, v));
      if (param.kind === 'choice' && param.options.some((o) => o.value === v)) p[param.key] = v as string;
    }
    const c: Record<string, string> = { ...def.defaults.c };
    for (const { key } of def.colors) if (isColor(s.c?.[key])) c[key] = s.c![key];
    out[def.id] = { on: typeof s.on === 'boolean' ? s.on : def.defaults.on, p, c };
  }
  return out;
}

class IndicatorStore extends Observable {
  value: IndicatorSettings = normalize(load('indicators', null));

  constructor() {
    super(0);
  }

  update(id: IndicatorId, patch: { on?: boolean; p?: Record<string, ParamValue>; c?: Record<string, string> }): void {
    const cur = this.value[id];
    const next = { on: patch.on ?? cur.on, p: { ...cur.p, ...patch.p }, c: { ...cur.c, ...patch.c } };
    this.value = normalize({ ...this.value, [id]: next });
    this.persist();
  }

  reset(id?: IndicatorId): void {
    if (id) this.value = { ...this.value, [id]: structuredClone(INDICATOR_BY_ID[id].defaults) };
    else this.value = normalize(null);
    this.persist();
  }

  activeCount(): number {
    return INDICATORS.filter((d) => this.value[d.id].on).length;
  }

  private persist(): void {
    save('indicators', this.value);
    this.emit(true);
  }
}

export const indicators = new IndicatorStore();
