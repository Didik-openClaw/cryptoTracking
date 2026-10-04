import { useEffect, useState } from 'react';
import { tr } from '../lib/i18n';
import { INDICATORS, indicators, type IndicatorDef, type ParamDef } from '../lib/indicatorSettings';
import { useObservable } from '../lib/observable';

/** Number field that only commits values inside [min, max]; shows the committed value again on blur. */
function NumField({ value, def, onChange }: { value: number; def: Extract<ParamDef, { kind: 'num' }>; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      className="input"
      type="number"
      inputMode="decimal"
      value={text}
      min={def.min}
      max={def.max}
      step={def.step ?? 1}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v) && v >= def.min && v <= def.max) onChange(v);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

function Row({ def }: { def: IndicatorDef }) {
  const cfg = indicators.value[def.id];
  const set = (patch: Parameters<typeof indicators.update>[1]) => indicators.update(def.id, patch);
  return (
    <div className={`ind-row${cfg.on ? ' on' : ''}`}>
      <label className="ind-name">
        <input type="checkbox" checked={cfg.on} onChange={(e) => set({ on: e.target.checked })} />
        <i className="ind-swatch" style={{ background: cfg.c[def.colors[0]?.key] }} />
        <span>{def.name()}</span>
        {cfg.on && <span className="ind-label">{def.label(cfg.p)}</span>}
      </label>
      {cfg.on && (
        <div className="ind-params">
          {def.params.map((param) => (
            <label key={param.key} className="ind-field">
              <span>{param.label()}</span>
              {param.kind === 'num' ? (
                <NumField value={Number(cfg.p[param.key])} def={param} onChange={(v) => set({ p: { [param.key]: v } })} />
              ) : (
                <select className="input" value={String(cfg.p[param.key])} onChange={(e) => set({ p: { [param.key]: e.target.value } })}>
                  {param.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label()}
                    </option>
                  ))}
                </select>
              )}
            </label>
          ))}
          {def.colors.map((col) => (
            <label key={col.key} className="ind-field ind-color" title={col.label()}>
              <span>{col.label()}</span>
              <input type="color" value={cfg.c[col.key]} onChange={(e) => set({ c: { [col.key]: e.target.value } })} />
            </label>
          ))}
          <button type="button" className="btn sm ghost" onClick={() => indicators.reset(def.id)} title={tr('Kembalikan pengaturan awal indikator ini', 'Restore this indicator’s defaults')}>
            {tr('Awal', 'Default')}
          </button>
        </div>
      )}
    </div>
  );
}

/** Settings for every chart indicator: on/off, parameters and colours (shared by all charts). */
export function IndicatorPanel({ onClose }: { onClose: () => void }) {
  useObservable(indicators);
  const group = (g: IndicatorDef['group']) => INDICATORS.filter((d) => d.group === g).map((d) => <Row key={d.id} def={d} />);
  return (
    <div className="ind-panel">
      <div className="ind-head">
        <b>{tr('Indikator', 'Indicators')}</b>
        <span className="muted">{tr('Berlaku untuk semua chart, tersimpan di browser ini', 'Applies to every chart, saved in this browser')}</span>
        <span className="grow" />
        <button type="button" className="btn sm ghost" onClick={() => indicators.reset()}>
          {tr('Reset semua', 'Reset all')}
        </button>
        <button type="button" className="btn sm" onClick={onClose}>
          {tr('Tutup', 'Close')}
        </button>
      </div>
      <div className="ind-group">
        <div className="ind-group-title">{tr('Di chart harga', 'On price chart')}</div>
        {group('overlay')}
      </div>
      <div className="ind-group">
        <div className="ind-group-title">{tr('Panel di bawah chart', 'Panels below the chart')}</div>
        {group('pane')}
      </div>
    </div>
  );
}
