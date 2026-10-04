import { useEffect, useMemo, useState } from 'react';
import { Addr } from '../components/Addr';
import { Empty, LongShortBar, Progress, Seg, Spinner, StatCard, useSort } from '../components/ui';
import { getClearinghouseState, Priority } from '../lib/api';
import { fmtPct, fmtPF, fmtShortDateTime, fmtSpan, fmtUsd, pfClass, pnlClass, wrClass } from '../lib/format';
import { tr } from '../lib/i18n';
import { useObservable } from '../lib/observable';
import { parseClearinghouse } from '../lib/positions';
import { scanner } from '../lib/scanner';
import { settings } from '../lib/settings';
import type { TraderStats } from '../lib/stats';
import { traderStats } from '../lib/traderStats';
import type { PerfWindow, SeedAccount, WalletSnapshot } from '../lib/types';

const TOP_N = 20;
const windowLabel = (): Record<PerfWindow, string> => ({
  day: tr('24 jam', '24h'),
  week: tr('7 hari', '7d'),
  month: tr('30 hari', '30d'),
  allTime: tr('semua waktu', 'all-time'),
});
type Rank = 'pnl' | 'roi';
type Criterion = 'acct1m' | 'acct10m' | 'holding';


/** Current positions of the listed wallets (cheap: 2 weight each), refreshed every minute. */
function useSnapshots(addresses: string[]): Map<string, WalletSnapshot> {
  const [snaps, setSnaps] = useState(() => new Map<string, WalletSnapshot>());
  const key = addresses.join();
  useEffect(() => {
    const ctl = new AbortController();
    const load = () => {
      for (const a of addresses)
        getClearinghouseState(a, Priority.User, ctl.signal).then(
          (st) => {
            const snap = parseClearinghouse(a, st);
            scanner.ingest(snap);
            setSnaps((m) => new Map(m).set(a, snap));
          },
          () => {},
        );
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      ctl.abort();
      clearInterval(t);
    };
    // `key` stands for the address list.
  }, [key]);
  return snaps;
}

interface Row {
  rank: number;
  seed: SeedAccount;
  stats: TraderStats | null;
  snap: WalletSnapshot | null;
  long: number;
  short: number;
}

export function TopWhalesPage() {
  const sv = useObservable(scanner);
  const tv = useObservable(traderStats);
  useObservable(settings);
  const minPos = settings.value.minPositionUsd;
  const [win, setWin] = useState<PerfWindow>('month');
  const [rankBy, setRankBy] = useState<Rank>('pnl');
  const [criterion, setCriterion] = useState<Criterion>('acct1m');

  const top = useMemo(() => {
    const seeds = [...scanner.seedMap.values()];
    const isWhale = (a: SeedAccount) => {
      if (criterion === 'acct1m') return a.accountValue >= 1e6;
      if (criterion === 'acct10m') return a.accountValue >= 1e7;
      const w = scanner.wallets.get(a.address);
      return !!w && w.positions.some((p) => p.positionValue >= minPos);
    };
    const metric = (a: SeedAccount) => (rankBy === 'pnl' ? a.pnl[win] : a.roi[win]);
    return seeds
      .filter(isWhale)
      .sort((a, b) => metric(b) - metric(a))
      .slice(0, TOP_N);
    // sv: whale membership changes as the scanner finds positions
  }, [sv, criterion, rankBy, win, minPos]);

  const addresses = useMemo(() => top.map((a) => a.address), [top]);
  const snaps = useSnapshots(addresses);
  useEffect(() => {
    for (const a of addresses) traderStats.request(a);
  }, [addresses]);

  const rows = useMemo<Row[]>(
    () =>
      top.map((seed, i) => {
        const snap = snaps.get(seed.address) ?? scanner.wallets.get(seed.address) ?? null;
        let long = 0,
          short = 0;
        for (const p of snap?.positions ?? []) {
          if (p.side === 'long') long += p.positionValue;
          else short += p.positionValue;
        }
        return { rank: i + 1, seed, stats: traderStats.get(seed.address)?.stats ?? null, snap, long, short };
      }),
    [top, snaps, tv],
  );

  const getters = useMemo(
    () => ({
      rank: (r: Row) => r.rank,
      value: (r: Row) => r.seed.accountValue,
      pnl: (r: Row) => r.seed.pnl[win],
      roi: (r: Row) => r.seed.roi[win],
      allTime: (r: Row) => r.seed.pnl.allTime,
      vlm: (r: Row) => r.seed.vlm[win],
      wr: (r: Row) => r.stats?.winRate ?? NaN,
      pf: (r: Row) => (r.stats?.profitFactor === Infinity ? 1e12 : (r.stats?.profitFactor ?? NaN)),
      trades: (r: Row) => r.stats?.trades ?? NaN,
      exp: (r: Row) => r.stats?.expectancy ?? NaN,
      hold: (r: Row) => r.stats?.avgHoldMs ?? NaN,
      longShare: (r: Row) => r.stats?.longShare ?? NaN,
      net: (r: Row) => r.long - r.short,
    }),
    [win],
  );
  const { sorted, th } = useSort(rows, getters, 'rank', 'asc');

  const loaded = rows.filter((r) => r.stats).length;
  const median = (xs: number[]) => {
    const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
  };
  const totalPnl = rows.reduce((t, r) => t + r.seed.pnl[win], 0);
  const medWr = median(rows.map((r) => r.stats?.winRate ?? NaN));
  const medPf = median(rows.map((r) => r.stats?.profitFactor ?? NaN));
  const longAll = rows.reduce((t, r) => t + r.long, 0);
  const shortAll = rows.reduce((t, r) => t + r.short, 0);
  const holding = rows.filter((r) => r.long + r.short > 0).length;
  const coinBias = useMemo(() => {
    const m = new Map<string, { l: number; s: number }>();
    for (const r of rows)
      for (const p of r.snap?.positions ?? []) {
        const c = m.get(p.coin) ?? { l: 0, s: 0 };
        if (p.side === 'long') c.l += p.positionValue;
        else c.s += p.positionValue;
        m.set(p.coin, c);
      }
    return [...m].sort((a, b) => b[1].l + b[1].s - (a[1].l + a[1].s)).slice(0, 3);
  }, [rows]);

  const whaleLabel =
    criterion === 'holding'
      ? tr(`pegang posisi ≥ ${fmtUsd(minPos, { decimals: 0 })}`, `holding ≥ ${fmtUsd(minPos, { decimals: 0 })}`)
      : criterion === 'acct10m'
        ? tr('akun ≥ $10M', 'account ≥ $10M')
        : tr('akun ≥ $1M', 'account ≥ $1M');
  const winLabel = windowLabel()[win];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            <span className="fn">TOPW</span>
            {tr('Top 20 Whale Profit', 'Top 20 Profitable Whales')}
          </h1>
          <p>
            {tr(
              <>
                Wallet whale ({whaleLabel}) dengan {rankBy === 'pnl' ? 'PnL' : 'ROI'} tertinggi {winLabel}, plus win rate,
                profit factor, dan statistik trade masing-masing.
              </>,
              <>
                Whale wallets ({whaleLabel}) ranked by {rankBy === 'pnl' ? 'PnL' : 'ROI'} ({winLabel}), plus each one's win
                rate, profit factor and trade stats.
              </>,
            )}
          </p>
        </div>
        <div className="filters">
          <div className="field">
            <span>{tr('Periode', 'Period')}</span>
            <Seg<PerfWindow>
              value={win}
              onChange={setWin}
              options={[
                { value: 'day', label: tr('24J', '24H') },
                { value: 'week', label: tr('7H', '7D') },
                { value: 'month', label: tr('30H', '30D') },
                { value: 'allTime', label: tr('Semua', 'All') },
              ]}
            />
          </div>
          <div className="field">
            <span>{tr('Ranking', 'Rank by')}</span>
            <Seg<Rank> value={rankBy} onChange={setRankBy} options={[{ value: 'pnl', label: 'PnL $' }, { value: 'roi', label: 'ROI %' }]} />
          </div>
          <div className="field">
            <span>Whale</span>
            <Seg<Criterion>
              value={criterion}
              onChange={setCriterion}
              options={[
                { value: 'acct1m', label: tr('Akun ≥ $1M', 'Account ≥ $1M') },
                { value: 'acct10m', label: tr('Akun ≥ $10M', 'Account ≥ $10M') },
                {
                  value: 'holding',
                  label: tr(`Posisi ≥ ${fmtUsd(minPos, { decimals: 0 })}`, `Position ≥ ${fmtUsd(minPos, { decimals: 0 })}`),
                },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="cards">
        <StatCard
          label={tr(`Total PnL top ${rows.length} · ${winLabel}`, `Top ${rows.length} total PnL · ${winLabel}`)}
          value={<span className={pnlClass(totalPnl)}>{fmtUsd(totalPnl, { sign: true })}</span>}
          sub={tr(
            `Rata-rata ${fmtUsd(rows.length ? totalPnl / rows.length : 0, { sign: true })} per wallet`,
            `Avg ${fmtUsd(rows.length ? totalPnl / rows.length : 0, { sign: true })} per wallet`,
          )}
        />
        <StatCard
          label="Median win rate · profit factor"
          value={
            <>
              <span className={wrClass(medWr)}>{medWr === null ? '–' : fmtPct(medWr, { decimals: 0 })}</span>
              <span className="dim"> · </span>
              <span className={pfClass(medPf)}>{fmtPF(medPf)}</span>
            </>
          }
          sub={tr(
            `Dari ${loaded}/${rows.length} wallet yang statistiknya sudah dimuat`,
            `From ${loaded}/${rows.length} wallets with stats loaded`,
          )}
        />
        <StatCard
          label={tr('Posisi top whale sekarang', 'Top whale positions now')}
          tone={longAll >= shortAll ? 'long' : 'short'}
          value={<span className={pnlClass(longAll - shortAll)}>Net {fmtUsd(longAll - shortAll, { sign: true })}</span>}
          sub={
            <>
              <LongShortBar long={longAll} short={shortAll} />
              <div style={{ marginTop: 4 }}>
                {holding}/{rows.length} {tr('pegang posisi', 'holding positions')} ·{' '}
                <span className="pos">L {fmtUsd(longAll)}</span> /{' '}
                <span className="neg">S {fmtUsd(shortAll)}</span>
              </div>
            </>
          }
        />
        <StatCard
          label={tr('Coin terbesar di posisi mereka', 'Largest coin in their positions')}
          value={coinBias[0]?.[0] ?? '–'}
          sub={
            coinBias.length
              ? coinBias.map(([c, v], i) => (
                  <span key={c}>
                    {i > 0 && ' · '}
                    {c} <span className="pos">L {fmtUsd(v.l, { decimals: 0 })}</span>/<span className="neg">S {fmtUsd(v.s, { decimals: 0 })}</span>
                  </span>
                ))
              : tr('Belum ada posisi terbuka', 'No open positions yet')
          }
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Peringkat', 'Rankings')}</h2>
          <span className="hint">
            {tr('Statistik trade', 'Trade stats')} {loaded}/{rows.length} {loaded < rows.length && <Spinner />}
          </span>
        </div>
        {loaded < rows.length && (
          <div style={{ marginBottom: 8 }}>
            <Progress value={rows.length ? loaded / rows.length : 0} />
          </div>
        )}
        {rows.length ? (
          <div className="table-wrap table-scroll" style={{ maxHeight: 'none' }}>
            <table>
              <thead>
                <tr>
                  {th('rank', '#', { num: true })}
                  <th>Wallet</th>
                  {th('value', tr('Nilai akun', 'Account value'), { num: true })}
                  {th('pnl', `PnL ${winLabel}`, { num: true })}
                  {th('roi', 'ROI', { num: true })}
                  {th('allTime', 'PnL all-time', { num: true })}
                  {th('vlm', 'Volume', { num: true })}
                  {th('wr', 'Win rate', {
                    num: true,
                    title: tr(
                      'Persentase trade (posisi dibuka sampai ditutup) yang profit',
                      'Share of trades (position opened to closed) that were profitable',
                    ),
                  })}
                  {th('pf', 'Profit factor', {
                    num: true,
                    title: tr(
                      'Total profit trade menang ÷ total rugi trade kalah. Di atas 1 = untung',
                      'Gross profit of winning trades ÷ gross loss of losing trades. Above 1 = profitable',
                    ),
                  })}
                  {th('trades', tr('Trade', 'Trades'), {
                    num: true,
                    title: tr('Jumlah trade selesai (W/L)', 'Closed trades (W/L)'),
                  })}
                  <th
                    className="num"
                    title={tr('Rata-rata trade menang / rata-rata trade kalah', 'Average winning trade / average losing trade')}
                  >
                    Avg win / loss
                  </th>
                  {th('exp', 'Expectancy', { num: true, title: tr('Rata-rata PnL per trade', 'Average PnL per trade') })}
                  <th className="num" title={tr('Trade terbaik / terburuk', 'Best / worst trade')}>
                    Best / worst
                  </th>
                  {th('hold', tr('Durasi', 'Hold time'), {
                    num: true,
                    title: tr(
                      'Rata-rata lama memegang posisi (m = menit, j = jam, hr = hari)',
                      'Average holding time (m = minutes, h = hours, d = days)',
                    ),
                  })}
                  {th('longShare', 'Bias', {
                    num: true,
                    title: tr('Porsi nilai posisi yang dibuka LONG', 'Share of position value opened LONG'),
                  })}
                  {th('net', tr('Posisi sekarang', 'Current positions'))}
                  <th title={tr('Rentang waktu fill yang dihitung', 'Time range of the fills analysed')}>Data</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const s = r.stats;
                  const pending = traderStats.isPending(r.seed.address);
                  const na = pending && !s ? <Spinner /> : '–';
                  return (
                    <tr key={r.seed.address}>
                      <td className="num warn">{r.rank}</td>
                      <td>
                        <Addr address={r.seed.address} />
                      </td>
                      <td className="num">{fmtUsd(r.seed.accountValue)}</td>
                      <td className={`num ${pnlClass(r.seed.pnl[win])}`}>
                        <b>{fmtUsd(r.seed.pnl[win], { sign: true })}</b>
                      </td>
                      <td className={`num ${pnlClass(r.seed.roi[win])}`}>{fmtPct(r.seed.roi[win], { sign: true, decimals: 1 })}</td>
                      <td className={`num ${pnlClass(r.seed.pnl.allTime)}`}>{fmtUsd(r.seed.pnl.allTime, { sign: true })}</td>
                      <td className="num muted">{fmtUsd(r.seed.vlm[win])}</td>
                      <td className={`num ${wrClass(s?.winRate)}`}>{s ? (s.winRate === null ? '–' : fmtPct(s.winRate, { decimals: 1 })) : na}</td>
                      <td className={`num ${pfClass(s?.profitFactor)}`}>{s ? fmtPF(s.profitFactor) : na}</td>
                      <td className="num">
                        {s ? (
                          <>
                            {s.trades} <span className="dim small">({s.wins}/{s.losses})</span>
                          </>
                        ) : (
                          na
                        )}
                      </td>
                      <td className="num small">
                        {s && s.trades ? (
                          <>
                            <span className="pos">{fmtUsd(s.avgWin)}</span> / <span className="neg">{fmtUsd(-s.avgLoss)}</span>
                          </>
                        ) : (
                          na
                        )}
                      </td>
                      <td className={`num ${pnlClass(s?.expectancy ?? 0)}`}>{s?.expectancy != null ? fmtUsd(s.expectancy, { sign: true }) : na}</td>
                      <td className="num small">
                        {s && s.trades ? (
                          <>
                            <span className="pos">{fmtUsd(s.bestTrade, { sign: true })}</span> /{' '}
                            <span className="neg">{fmtUsd(s.worstTrade, { sign: true })}</span>
                          </>
                        ) : (
                          na
                        )}
                      </td>
                      <td className="num">{s ? fmtSpan(s.avgHoldMs) : na}</td>
                      <td className="num">
                        {s?.longShare != null ? (
                          <span className={s.longShare >= 0.5 ? 'pos' : 'neg'}>
                            {s.longShare >= 0.5 ? `${Math.round(s.longShare * 100)}% L` : `${Math.round((1 - s.longShare) * 100)}% S`}
                          </span>
                        ) : (
                          na
                        )}
                      </td>
                      <td style={{ minWidth: 150 }}>
                        {r.snap ? (
                          r.long + r.short > 0 ? (
                            <div>
                              <LongShortBar long={r.long} short={r.short} />
                              <span className="small">
                                <span className="pos">L {fmtUsd(r.long)}</span> / <span className="neg">S {fmtUsd(r.short)}</span>
                                {r.snap.positions[0] && <span className="dim"> · {r.snap.positions[0].coin}</span>}
                              </span>
                            </div>
                          ) : (
                            <span className="dim small">{tr('tidak ada posisi', 'no positions')}</span>
                          )
                        ) : (
                          <Spinner />
                        )}
                      </td>
                      <td
                        className="small dim nowrap"
                        title={
                          s
                            ? tr(
                                `${s.fills} fill, ${s.tradesPerDay?.toFixed(1) ?? '–'} trade/hari, coin: ${s.topCoins.join(', ')}`,
                                `${s.fills} fills, ${s.tradesPerDay?.toFixed(1) ?? '–'} trades/day, coins: ${s.topCoins.join(', ')}`,
                              )
                            : ''
                        }
                      >
                        {s && s.fills
                          ? `${fmtShortDateTime(s.from).slice(0, 6)} – ${fmtShortDateTime(s.to).slice(0, 6)}`
                          : s
                            ? tr('tidak ada fill', 'no fills')
                            : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>
            {scanner.seedMap.size ? (
              criterion === 'holding' ? (
                tr(
                  <>Belum ada whale dengan posisi ≥ {fmtUsd(minPos)} yang ditemukan scanner. Tunggu scan berjalan.</>,
                  <>The scanner hasn't found any whales with positions ≥ {fmtUsd(minPos)} yet. Let the scan run.</>,
                )
              ) : (
                tr('Tidak ada wallet yang memenuhi kriteria.', 'No wallets match the criteria.')
              )
            ) : (
              <>
                <Spinner /> {tr('Memuat leaderboard…', 'Loading leaderboard…')}
              </>
            )}
          </Empty>
        )}
        <div className="small dim" style={{ marginTop: 8, lineHeight: 1.6 }}>
          {tr(
            <>
              PnL, ROI, volume: leaderboard Hyperliquid. Win rate, profit factor, expectancy, durasi, bias: dihitung dari 2000
              fill terakhir tiap wallet, per trade (posisi dibuka sampai ditutup atau dibalik), sebelum fee. Profit factor ∞ =
              belum ada trade rugi di periode data. Statistik disimpan di browser 6 jam.
            </>,
            <>
              PnL, ROI, volume: Hyperliquid leaderboard. Win rate, profit factor, expectancy, hold time, bias: computed from each
              wallet's last 2000 fills, per trade (position opened until closed or flipped), before fees. Profit factor ∞ = no
              losing trade in the data period. Stats are cached in the browser for 6 hours.
            </>,
          )}
        </div>
      </section>
    </div>
  );
}
