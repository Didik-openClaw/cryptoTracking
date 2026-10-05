import { useState } from 'react';
import { fmtAgo, fmtPct, fmtPx } from '../lib/format';
import { tr } from '../lib/i18n';
import { market } from '../lib/market';
import { notifier } from '../lib/notify';
import { useObservable } from '../lib/observable';
import { describeAlert, priceAlerts, type AlertKind } from '../lib/priceAlerts';
import { pxDecimals } from '../lib/format';
import { Empty, Seg } from './ui';

/** Add and manage price alerts; with `coin`, only that coin's alerts (coin page), otherwise all (calculator page). */
export function PriceAlertPanel({ coin }: { coin?: string }) {
  useObservable(priceAlerts);
  useObservable(market);
  useObservable(notifier);
  const [pick, setPick] = useState(coin ?? 'BTC');
  const target = coin ?? pick;
  const live = market.mids.get(target);
  const [kind, setKind] = useState<AlertKind>('above');
  const [price, setPrice] = useState('');
  const [pct, setPct] = useState('3');
  const [windowMin, setWindowMin] = useState('15');
  const [note, setNote] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [err, setErr] = useState('');

  const coins = market.topCoins(400).sort();
  const list = priceAlerts.forCoin(coin);

  const useLive = () => live && setPrice(live.toFixed(Math.min(8, pxDecimals(live))));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = Number(price.replace(',', '.'));
    const q = Number(pct.replace(',', '.'));
    const w = Math.round(Number(windowMin));
    if (kind !== 'pctMove' && !(p > 0)) return setErr(tr('Isi harga yang valid.', 'Enter a valid price.'));
    if (kind === 'pctMove' && !(q > 0 && w >= 1 && w <= 240)) return setErr(tr('Isi persen > 0 dan jendela 1–240 menit.', 'Enter a percent > 0 and a 1–240 minute window.'));
    priceAlerts.add({
      coin: target,
      kind,
      ...(kind === 'pctMove' ? { pct: q, windowMin: w } : { price: p }),
      note: note.trim().slice(0, 80) || undefined,
      repeat,
    });
    setErr('');
    setNote('');
    if (notifier.permission === 'default') void notifier.requestPermission();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{coin ? tr(`Alert harga ${coin}`, `${coin} price alerts`) : tr('Alert harga', 'Price alerts')}</h2>
        <span className="hint">{live ? `${target} ${fmtPx(live)}` : ''}</span>
      </div>
      <form className="filters pa-form" onSubmit={submit}>
        {!coin && (
          <label className="field">
            <span>Coin</span>
            <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
              {coins.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{tr('Jenis', 'Type')}</span>
          <Seg<AlertKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'above', label: tr('Naik ke', 'Above') },
              { value: 'below', label: tr('Turun ke', 'Below') },
              { value: 'pctMove', label: tr('Gerak %', 'Move %') },
            ]}
          />
        </label>
        {kind === 'pctMove' ? (
          <>
            <label className="field">
              <span>%</span>
              <input className="input pa-num" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} />
            </label>
            <label className="field">
              <span>{tr('Dalam (menit)', 'Within (min)')}</span>
              <input className="input pa-num" inputMode="numeric" value={windowMin} onChange={(e) => setWindowMin(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="field">
            <span>{tr('Harga', 'Price')}</span>
            <div className="row" style={{ gap: 4 }}>
              <input className="input pa-num" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={live ? fmtPx(live) : ''} />
              <button type="button" className="btn sm ghost" onClick={useLive} disabled={!live}>
                {tr('Harga kini', 'Live')}
              </button>
            </div>
          </label>
        )}
        <label className="field grow">
          <span>{tr('Catatan', 'Note')}</span>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr('opsional', 'optional')} maxLength={80} />
        </label>
        <label className="check small">
          <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> {tr('Berulang', 'Repeat')}
        </label>
        <button type="submit" className="btn primary sm">
          {tr('Pasang alert', 'Set alert')}
        </button>
      </form>
      {err && <p className="danger small">{err}</p>}

      {list.length ? (
        <div className="table-wrap">
          <table className="pa-list">
            <thead>
              <tr>
                <th>{tr('Alert', 'Alert')}</th>
                <th className="num">{tr('Jarak', 'Distance')}</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((a) => {
                const cur = market.mids.get(a.coin);
                const dist = a.kind !== 'pctMove' && cur && a.price ? a.price / cur - 1 : null;
                return (
                  <tr key={a.id} className={a.active ? '' : 'dim'}>
                    <td>
                      <a href={`#/coin/${encodeURIComponent(a.coin)}`}>{describeAlert(a)}</a>
                      {a.repeat && <span className="dim small"> ↻</span>}
                      {a.note && <div className="dim small">{a.note}</div>}
                    </td>
                    <td className="num">{dist === null ? '–' : fmtPct(dist, { sign: true })}</td>
                    <td className="small">
                      {a.triggeredAt ? (
                        <span className="warn">
                          {tr('kena', 'hit')} {fmtAgo(a.triggeredAt)}
                        </span>
                      ) : a.active ? (
                        <span className="pos">{tr('aktif', 'active')}</span>
                      ) : (
                        tr('mati', 'off')
                      )}
                    </td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>
                      {!a.active && (
                        <button type="button" className="btn sm ghost" onClick={() => priceAlerts.rearm(a.id)}>
                          {tr('Aktifkan', 'Re-arm')}
                        </button>
                      )}{' '}
                      <button type="button" className="btn sm ghost" onClick={() => priceAlerts.remove(a.id)} aria-label={tr('Hapus alert', 'Delete alert')}>
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>
          {tr(
            'Belum ada alert. Alert dicek selama terminal terbuka, dengan notifikasi browser dan bunyi (atur di Pengaturan).',
            'No alerts yet. Alerts are checked while the terminal is open, with browser notifications and sound (see Settings).',
          )}
        </Empty>
      )}
    </section>
  );
}
