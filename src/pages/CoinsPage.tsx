import { useMemo } from 'react';
import { Empty, LongShortBar, UsdSelect, useSort } from '../components/ui';
import { fmtPct, fmtPx, fmtUsd, pnlClass } from '../lib/format';
import { market } from '../lib/market';
import { useObservable } from '../lib/observable';
import { aggregateByCoin, type CoinAggregate } from '../lib/positions';
import { settings } from '../lib/settings';
import { useWhalePositions } from '../hooks';

type Row = CoinAggregate & { total: number; net: number; oiUsd: number; funding: number; change: number; volume: number };
type Col = 'coin' | 'mark' | 'change' | 'funding' | 'oi' | 'long' | 'short' | 'ratio' | 'net' | 'oiShare' | 'total';

const getters: Record<Col, (r: Row) => number | string> = {
  coin: (r) => r.coin,
  mark: (r) => r.mark,
  change: (r) => r.change,
  funding: (r) => r.funding,
  oi: (r) => r.oiUsd,
  long: (r) => r.longUsd,
  short: (r) => r.shortUsd,
  ratio: (r) => (r.total ? r.longUsd / r.total : 0.5),
  net: (r) => r.net,
  oiShare: (r) => (r.oiUsd ? r.total / (2 * r.oiUsd) : NaN),
  total: (r) => r.total,
};

export function CoinsPage() {
  useObservable(settings);
  const mv = useObservable(market);
  const s = settings.value;
  const positions = useWhalePositions(s.minPositionUsd);

  const rows = useMemo<Row[]>(
    () =>
      aggregateByCoin(positions).map((a) => {
        const info = market.coins.get(a.coin);
        const mark = market.mids.get(a.coin) ?? info?.mark ?? a.mark;
        return {
          ...a,
          mark,
          total: a.longUsd + a.shortUsd,
          net: a.longUsd - a.shortUsd,
          oiUsd: info ? info.openInterest * mark : 0,
          funding: info?.funding ?? 0,
          change: info?.prevDayPx ? mark / info.prevDayPx - 1 : 0,
          volume: info?.dayVolumeUsd ?? 0,
        };
      }),
    [positions, mv],
  );
  const { sorted, th } = useSort(rows, getters, 'total');

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Long vs Short per Coin</h1>
          <p>
            Total posisi whale (≥ {fmtUsd(s.minPositionUsd, { decimals: 0 })}) di setiap perp, dipisah LONG dan SHORT.
            Klik coin untuk melihat daftar wallet di tiap sisi, harga entry, dan peta likuidasinya.
          </p>
        </div>
        <div className="row">
          <span className="muted small">Posisi minimal</span>
          <UsdSelect value={s.minPositionUsd} onChange={(v) => settings.update({ minPositionUsd: v })} />
        </div>
      </div>
      <section className="panel">
        {sorted.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {th('coin', 'Coin')}
                  {th('mark', 'Harga', { num: true })}
                  {th('change', '24j', { num: true })}
                  {th('funding', 'Funding/jam', { num: true, title: 'Funding rate per jam (APR dalam kurung). Positif = long bayar short' })}
                  {th('oi', 'Open Interest', { num: true })}
                  {th('long', 'Whale LONG', { num: true })}
                  {th('ratio', 'Rasio L/S')}
                  {th('short', 'Whale SHORT', { num: true })}
                  {th('net', 'Net', { num: true })}
                  {th('oiShare', '% dari OI', { num: true, title: 'Porsi posisi whale terhadap open interest' })}
                  <th className="num">Avg entry L / S</th>
                  <th className="num">uPnL L / S</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.coin} className="clickable" onClick={() => (location.hash = `#/coin/${encodeURIComponent(r.coin)}`)}>
                    <td>
                      <span className="coin">{r.coin}</span>
                    </td>
                    <td className="num">{fmtPx(r.mark)}</td>
                    <td className={`num ${pnlClass(r.change)}`}>{fmtPct(r.change, { sign: true })}</td>
                    <td className={`num ${pnlClass(r.funding)}`}>
                      {fmtPct(r.funding, { decimals: 4 })}{' '}
                      <span className="dim small">({fmtPct(r.funding * 24 * 365, { decimals: 1 })})</span>
                    </td>
                    <td className="num muted">{fmtUsd(r.oiUsd)}</td>
                    <td className="num">
                      {r.longCount ? (
                        <>
                          <b className="pos">{fmtUsd(r.longUsd)}</b> <span className="dim small">({r.longCount})</span>
                        </>
                      ) : (
                        <span className="dim">–</span>
                      )}
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <LongShortBar long={r.longUsd} short={r.shortUsd} />
                    </td>
                    <td className="num">
                      {r.shortCount ? (
                        <>
                          <b className="neg">{fmtUsd(r.shortUsd)}</b> <span className="dim small">({r.shortCount})</span>
                        </>
                      ) : (
                        <span className="dim">–</span>
                      )}
                    </td>
                    <td className={`num ${pnlClass(r.net)}`}>{fmtUsd(r.net, { sign: true })}</td>
                    <td className="num muted">{r.oiUsd ? fmtPct(r.total / (2 * r.oiUsd), { decimals: 1 }) : '–'}</td>
                    <td className="num small">
                      <span className="pos">{fmtPx(r.longAvgEntry)}</span> / <span className="neg">{fmtPx(r.shortAvgEntry)}</span>
                    </td>
                    <td className="num small">
                      {r.longCount ? <span className={pnlClass(r.longPnl)}>{fmtUsd(r.longPnl, { sign: true })}</span> : '–'} /{' '}
                      {r.shortCount ? <span className={pnlClass(r.shortPnl)}>{fmtUsd(r.shortPnl, { sign: true })}</span> : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Belum ada posisi whale. Scanner masih berjalan, coba lagi sebentar.</Empty>
        )}
      </section>
    </div>
  );
}
