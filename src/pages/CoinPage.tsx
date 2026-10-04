import { useEffect, useMemo, useState } from 'react';
import { Addr } from '../components/Addr';
import { NewsPanel } from '../components/NewsPanel';
import { Opened } from '../components/Opened';
import { PriceChart, type ChartLine } from '../components/Charts';
import { Empty, LiqDist, LongShortBar, Pnl, Seg, StatCard, UsdSelect } from '../components/ui';
import { fmtPct, fmtPx, fmtSize, fmtUsd, pnlClass } from '../lib/format';
import { plural, tr } from '../lib/i18n';
import { market } from '../lib/market';
import { openTimes } from '../lib/openTimes';
import { levelColors, theme } from '../lib/theme';
import { useObservable } from '../lib/observable';
import { settings } from '../lib/settings';
import type { LivePosition } from '../lib/types';
import { useWhalePositions } from '../hooks';

const LINE_LIMITS = [5, 10, 20, 50];

export function CoinPage({ coin }: { coin: string }) {
  useObservable(settings);
  useObservable(market);
  const s = settings.value;
  const all = useWhalePositions(s.minPositionUsd);
  const positions = useMemo(() => all.filter((p) => p.coin === coin), [all, coin]);
  const longs = useMemo(() => positions.filter((p) => p.side === 'long').sort((a, b) => b.notional - a.notional), [positions]);
  const shorts = useMemo(() => positions.filter((p) => p.side === 'short').sort((a, b) => b.notional - a.notional), [positions]);
  const [showEntry, setShowEntry] = useState(true);
  const [showLiq, setShowLiq] = useState(true);
  const [lineLimit, setLineLimit] = useState(10);

  const info = market.coins.get(coin);
  const mark = market.mids.get(coin) ?? info?.mark ?? 0;
  const longUsd = longs.reduce((t, p) => t + p.notional, 0);
  const shortUsd = shorts.reduce((t, p) => t + p.notional, 0);
  const avgEntry = (ps: LivePosition[]) => {
    const size = ps.reduce((t, p) => t + p.size, 0);
    return size ? ps.reduce((t, p) => t + p.entryPx * p.size, 0) / size : 0;
  };

  const tv = useObservable(theme);
  const LEVEL = levelColors();
  const lines = useMemo<ChartLine[]>(() => {
    const top = [...positions].sort((a, b) => b.notional - a.notional).slice(0, lineLimit);
    const out: ChartLine[] = [];
    for (const p of top) {
      const color = p.side === 'long' ? LEVEL.long : LEVEL.short;
      const tag = `${p.side === 'long' ? 'L' : 'S'} ${fmtUsd(p.notional, { decimals: 1 })}`;
      if (showEntry) out.push({ price: p.entryPx, color, title: `Entry ${tag}` });
      if (showLiq && p.liquidationPx) out.push({ price: p.liquidationPx, color: LEVEL.liq, title: `Liq ${tag}`, dashed: true });
    }
    return out;
    // tv: level colours follow the theme
  }, [positions, lineLimit, showEntry, showLiq, tv]);

  // Liquidation map: walk outward from the mark price and accumulate notional
  // that would be force-closed if price got there.
  const liqMap = useMemo(() => {
    const withLiq = positions.filter((p) => p.liquidationPx);
    const below = withLiq.filter((p) => p.liquidationPx! < mark).sort((a, b) => b.liquidationPx! - a.liquidationPx!);
    const above = withLiq.filter((p) => p.liquidationPx! >= mark).sort((a, b) => a.liquidationPx! - b.liquidationPx!);
    const cum = (ps: LivePosition[]) => {
      let c = 0;
      return ps.map((p) => ({ p, cum: (c += p.notional) }));
    };
    return { below: cum(below), above: cum(above) };
  }, [positions, mark]);

  const change = info?.prevDayPx ? mark / info.prevDayPx - 1 : 0;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <div className="small">
            <a href="#/coins">← Long vs Short</a>
          </div>
          <h1>
            <span className="fn">{coin}</span>Perp · Whale Long/Short <span className="h1-value">{fmtPx(mark)}</span>
            <span className={`h1-value small ${pnlClass(change)}`}>{fmtPct(change, { sign: true })}</span>
          </h1>
          {info && (
            <p className="small">
              {tr(
                <>
                  Funding {fmtPct(info.funding, { decimals: 4 })}/jam ({fmtPct(info.funding * 24 * 365, { decimals: 1 })} APR) ·
                  OI {fmtUsd(info.openInterest * mark)} · Volume 24j {fmtUsd(info.dayVolumeUsd)} · Leverage maks{' '}
                  {info.maxLeverage}x
                </>,
                <>
                  Funding {fmtPct(info.funding, { decimals: 4 })}/h ({fmtPct(info.funding * 24 * 365, { decimals: 1 })} APR) ·
                  OI {fmtUsd(info.openInterest * mark)} · 24h volume {fmtUsd(info.dayVolumeUsd)} · Max leverage{' '}
                  {info.maxLeverage}x
                </>,
              )}
            </p>
          )}
        </div>
        <div className="row">
          <span className="muted small">{tr('Posisi minimal', 'Min. position')}</span>
          <UsdSelect value={s.minPositionUsd} onChange={(v) => settings.update({ minPositionUsd: v })} />
        </div>
      </div>

      <div className="cards">
        <StatCard
          label="Whale LONG"
          tone="long"
          value={<span className="pos">{fmtUsd(longUsd)}</span>}
          sub={tr(
            `${longs.length} wallet · avg entry ${fmtPx(avgEntry(longs))}`,
            `${plural(longs.length, 'wallet')} · avg entry ${fmtPx(avgEntry(longs))}`,
          )}
        />
        <StatCard
          label="Whale SHORT"
          tone="short"
          value={<span className="neg">{fmtUsd(shortUsd)}</span>}
          sub={tr(
            `${shorts.length} wallet · avg entry ${fmtPx(avgEntry(shorts))}`,
            `${plural(shorts.length, 'wallet')} · avg entry ${fmtPx(avgEntry(shorts))}`,
          )}
        />
        <StatCard
          label={tr('Net posisi whale', 'Whale net position')}
          value={<span className={pnlClass(longUsd - shortUsd)}>{fmtUsd(longUsd - shortUsd, { sign: true })}</span>}
          sub={<LongShortBar long={longUsd} short={shortUsd} big />}
        />
        <StatCard
          label={tr('Porsi dari Open Interest', 'Share of Open Interest')}
          value={info?.openInterest ? fmtPct((longUsd + shortUsd) / (2 * info.openInterest * mark), { decimals: 1 }) : '–'}
          sub={`Long ${info?.openInterest ? fmtPct(longUsd / (info.openInterest * mark), { decimals: 1 }) : '–'} · Short ${
            info?.openInterest ? fmtPct(shortUsd / (info.openInterest * mark), { decimals: 1 }) : '–'
          } ${tr('dari OI', 'of OI')}`}
        />
      </div>

      <div className="grid-chart">
        <section className="panel">
          <div className="panel-head">
            <h2>{tr(<>Level entry &amp; likuidasi whale</>, <>Whale entry &amp; liquidation levels</>)}</h2>
            <div className="row">
              <label className="check small">
                <input type="checkbox" checked={showEntry} onChange={(e) => setShowEntry(e.target.checked)} /> Entry
              </label>
              <label className="check small">
                <input type="checkbox" checked={showLiq} onChange={(e) => setShowLiq(e.target.checked)} />{' '}
                {tr('Likuidasi', 'Liquidation')}
              </label>
              <Seg value={lineLimit} onChange={setLineLimit} options={LINE_LIMITS.map((v) => ({ value: v, label: `Top ${v}` }))} />
            </div>
          </div>
          <PriceChart coin={coin} lines={lines} />
          <div className="legend" style={{ marginTop: 8 }}>
            <span>
              <i style={{ borderColor: LEVEL.long }} />
              Entry long
            </span>
            <span>
              <i style={{ borderColor: LEVEL.short }} />
              Entry short
            </span>
            <span>
              <i className="dash" style={{ borderColor: LEVEL.liq }} />
              {tr('Harga likuidasi', 'Liquidation price')}
            </span>
          </div>
        </section>
        <NewsPanel coin={coin} />
      </div>

      <div className="grid-2">
        <SideList title={tr('Siapa yang LONG', 'Who is LONG')} tone="long" rows={longs} />
        <SideList title={tr('Siapa yang SHORT', 'Who is SHORT')} tone="short" rows={shorts} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Peta likuidasi whale', 'Whale liquidation map')}</h2>
          <span className="hint">
            {tr(
              'Kumulatif nilai posisi yang terlikuidasi jika harga bergerak ke level tersebut',
              'Cumulative position value liquidated if price moves to that level',
            )}
          </span>
        </div>
        <div className="grid-2">
          <LiqTable
            title={tr('Jika harga TURUN (long terlikuidasi)', 'If price FALLS (longs liquidated)')}
            rows={liqMap.below}
            mark={mark}
          />
          <LiqTable
            title={tr('Jika harga NAIK (short terlikuidasi)', 'If price RISES (shorts liquidated)')}
            rows={liqMap.above}
            mark={mark}
          />
        </div>
      </section>
    </div>
  );
}

function SideList({ title, tone, rows }: { title: string; tone: 'long' | 'short'; rows: LivePosition[] }) {
  useEffect(() => {
    for (const p of rows.slice(0, 40)) openTimes.request(p.address);
  }, [rows]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className={tone === 'long' ? 'pos' : 'neg'}>
          {title} <span className="tag">{rows.length}</span>
        </h2>
      </div>
      {rows.length ? (
        <div className="table-wrap compact table-scroll" style={{ maxHeight: 520 }}>
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th className="num">{tr('Nilai', 'Value')}</th>
                <th className="num">Size</th>
                <th className="num">Entry</th>
                <th className="num">Liq.</th>
                <th className="num">{tr('Jarak', 'Distance')}</th>
                <th className="num">Lev</th>
                <th className="num">uPnL</th>
                <th
                  title={tr(
                    'Umur posisi sejak dibuka (m = menit, j = jam, hr = hari)',
                    'Position age since opened (m = minutes, h = hours, d = days)',
                  )}
                >
                  {tr('Umur', 'Age')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.address}>
                  <td>
                    <Addr address={p.address} />
                  </td>
                  <td className="num">
                    <b>{fmtUsd(p.notional)}</b>
                  </td>
                  <td className="num muted">{fmtSize(p.size)}</td>
                  <td className="num">{fmtPx(p.entryPx)}</td>
                  <td className="num">{fmtPx(p.liquidationPx)}</td>
                  <td className="num">
                    <LiqDist d={p.liqDistance} />
                  </td>
                  <td className="num">{p.leverage}x</td>
                  <td className="num">
                    <Pnl v={p.livePnl} />
                  </td>
                  <td>
                    <Opened address={p.address} coin={p.coin} side={p.side} compact />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{tr('Tidak ada whale di sisi ini.', 'No whales on this side.')}</Empty>
      )}
    </section>
  );
}

function LiqTable({ title, rows, mark }: { title: string; rows: { p: LivePosition; cum: number }[]; mark: number }) {
  return (
    <div>
      <h3 className="small muted" style={{ margin: '0 0 8px' }}>
        {title}
      </h3>
      {rows.length ? (
        <div className="table-wrap compact table-scroll" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th className="num">{tr('Harga liq.', 'Liq. price')}</th>
                <th className="num">{tr('Gerak', 'Move')}</th>
                <th>Wallet</th>
                <th className="num">{tr('Nilai', 'Value')}</th>
                <th className="num">{tr('Kumulatif', 'Cumulative')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, cum }) => (
                <tr key={p.address}>
                  <td className="num">{fmtPx(p.liquidationPx)}</td>
                  <td className="num">
                    <LiqDist d={mark ? Math.abs(p.liquidationPx! - mark) / mark : null} />
                  </td>
                  <td>
                    <Addr address={p.address} star={false} />
                  </td>
                  <td className="num">{fmtUsd(p.notional)}</td>
                  <td className="num">
                    <b>{fmtUsd(cum)}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{tr('Tidak ada.', 'None.')}</Empty>
      )}
    </div>
  );
}
