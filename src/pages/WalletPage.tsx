import { useEffect, useMemo, useState } from 'react';
import { CopyBtn } from '../components/Addr';
import { NewsPanel } from '../components/NewsPanel';
import { OpenedText } from '../components/Opened';
import { HistoryChart, PriceChart, type ChartLine, type ChartMarker } from '../components/Charts';
import { Empty, LiqDist, Pnl, Seg, SideBadge, Spinner, StatCard, Tabs } from '../components/ui';
import {
  getClearinghouseState,
  getLedger,
  getOpenOrders,
  getPortfolio,
  getSpotState,
  getUserFills,
  getUserFunding,
  Priority,
} from '../lib/api';
import {
  fmtAge,
  fmtDateTime,
  fmtPct,
  fmtPF,
  fmtPx,
  fmtShortDateTime,
  fmtSize,
  fmtSpan,
  fmtUsd,
  isAddress,
  num,
  pfClass,
  pnlClass,
  shortAddr,
  wrClass,
} from '../lib/format';
import { plural, tr } from '../lib/i18n';
import { market } from '../lib/market';
import { useObservable } from '../lib/observable';
import { fillsService } from '../lib/fills';
import { findOpenTime, openTimes } from '../lib/openTimes';
import { parseClearinghouse, toLive } from '../lib/positions';
import { levelColors, theme } from '../lib/theme';
import { scanner } from '../lib/scanner';
import { computeFillStats, computeTraderStats, roundTrips } from '../lib/stats';
import type { HLFill, HLFundingEntry, HLLedgerEntry, HLOpenOrder, HLPortfolio, HLSpotBalance, WalletSnapshot } from '../lib/types';
import { translateDir, watchlist } from '../lib/watchlist';

const FUNDING_DAYS = 7;
const LEDGER_DAYS = 365;
const REFRESH_MS = 15_000;

interface Data {
  snap: WalletSnapshot | null;
  spot: HLSpotBalance[] | null;
  orders: HLOpenOrder[] | null;
  fills: HLFill[] | null;
  portfolio: HLPortfolio | null;
}
type Key = keyof Data;
const EMPTY: Data = { snap: null, spot: null, orders: null, fills: null, portfolio: null };

/** Positions, orders, fills, portfolio and spot load with the page; positions refresh every 15s. */
function useWalletData(address: string) {
  const [data, setData] = useState<Data>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<Key, string>>>({});

  useEffect(() => {
    const ctl = new AbortController();
    const sig = ctl.signal;
    setData(EMPTY);
    setErrors({});
    const load = <K extends Key>(key: K, p: Promise<Data[K]>) =>
      p.then(
        (v) => !sig.aborted && setData((d) => ({ ...d, [key]: v })),
        (e: Error) => !sig.aborted && e.name !== 'AbortError' && setErrors((x) => ({ ...x, [key]: e.message })),
      );
    const loadSnap = () =>
      load(
        'snap',
        getClearinghouseState(address, Priority.User, sig).then((st) => {
          const snap = parseClearinghouse(address, st);
          scanner.ingest(snap);
          return snap;
        }),
      );
    void loadSnap();
    void load('portfolio', getPortfolio(address, sig));
    void load('orders', getOpenOrders(address, sig));
    void load('fills', getUserFills(address, sig).then((f) => [...f].sort((a, b) => b.time - a.time)));
    void load('spot', getSpotState(address, sig).then((s) => s.balances ?? []));
    const t = setInterval(() => void loadSnap(), REFRESH_MS);
    return () => {
      ctl.abort();
      clearInterval(t);
    };
  }, [address]);

  return { data, errors };
}

/**
 * Fetch once `enabled` turns true. Used for funding and ledger history:
 * heavier requests that most visits never look at.
 */
function useLazy<T>(enabled: boolean, fetcher: (signal: AbortSignal) => Promise<T>): { data: T | null; error?: string } {
  const [state, setState] = useState<{ data: T | null; error?: string }>({ data: null });
  useEffect(() => {
    if (!enabled) return;
    const ctl = new AbortController();
    fetcher(ctl.signal).then(
      (data) => !ctl.signal.aborted && setState({ data }),
      (e: Error) => !ctl.signal.aborted && e.name !== 'AbortError' && setState({ data: null, error: e.message }),
    );
    return () => ctl.abort();
    // The fetcher closes over the address, which remounts this component when it changes.
  }, [enabled]);
  return state;
}

type Tab = 'positions' | 'chart' | 'orders' | 'fills' | 'funding' | 'ledger' | 'spot' | 'stats';
type Win = 'day' | 'week' | 'month' | 'allTime';

export function WalletPage({ address: raw }: { address: string }) {
  const address = raw.toLowerCase();
  if (!isAddress(address)) return <Empty>{tr('Alamat tidak valid', 'Invalid address')}: {raw}</Empty>;
  return <Wallet key={address} address={address} />;
}

function Wallet({ address }: { address: string }) {
  const mv = useObservable(market);
  useObservable(watchlist);
  const { data, errors } = useWalletData(address);
  const [tab, setTab] = useState<Tab>('positions');
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set(['positions']));
  const openTab = (t: Tab) => {
    setTab(t);
    setVisited((v) => (v.has(t) ? v : new Set(v).add(t)));
  };
  const funding = useLazy(visited.has('funding'), (sig) => getUserFunding(address, Date.now() - FUNDING_DAYS * 86_400_000, sig));
  const ledger = useLazy(visited.has('ledger'), (sig) => getLedger(address, Date.now() - LEDGER_DAYS * 86_400_000, sig));
  const [win, setWin] = useState<Win>('month');
  const [perpOnly, setPerpOnly] = useState(false);
  const [mode, setMode] = useState<'equity' | 'pnl'>('pnl');
  const seed = scanner.seedMap.get(address);
  const watched = watchlist.get(address);
  const label = watchlist.labelOf(address);

  const positions = useMemo(
    () => (data.snap ? data.snap.positions.map((p) => toLive(p, data.snap!, market.mids)) : []),
    [data.snap, mv], // mv: re-price on every market tick
  );
  const snap = data.snap;
  // Share what this page fetched: trader stats (Top Whale) and open times (scanner tables).
  useEffect(() => {
    if (data.fills) fillsService.publish(address, data.fills);
  }, [address, data.fills]);
  useEffect(() => {
    if (data.fills && data.snap) openTimes.ingest(address, data.fills, data.snap);
  }, [address, data.fills, data.snap]);
  const totalPnl = positions.reduce((t, p) => t + p.livePnl, 0);
  const totalNtl = positions.reduce((t, p) => t + p.notional, 0);
  const longNtl = positions.filter((p) => p.side === 'long').reduce((t, p) => t + p.notional, 0);

  const portfolioWin = useMemo(() => {
    const key = (perpOnly ? `perp${win[0].toUpperCase()}${win.slice(1)}` : win) as string;
    return data.portfolio?.find(([k]) => k === key)?.[1] ?? null;
  }, [data.portfolio, win, perpOnly]);
  const winPnl = portfolioWin?.pnlHistory.length ? num(portfolioWin.pnlHistory[portfolioWin.pnlHistory.length - 1][1]) : null;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'positions', label: tr('Posisi', 'Positions'), count: positions.length },
    { id: 'chart', label: tr('Chart Trade', 'Trade Chart') },
    { id: 'orders', label: tr('Open Order', 'Open Orders'), count: data.orders?.length },
    { id: 'fills', label: tr('Riwayat Trade', 'Trade History'), count: data.fills?.length },
    { id: 'funding', label: 'Funding' },
    { id: 'ledger', label: tr('Deposit & Transfer', 'Deposits & Transfers') },
    { id: 'spot', label: 'Spot' },
    { id: 'stats', label: tr('Statistik', 'Stats') },
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="small">
            <a href="#/">← Scanner</a>
          </div>
          <h1>
            <span className="fn">WLT</span>
            {label || 'Wallet'}
            <span className="h1-value muted" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>
              {address}
            </span>
            <CopyBtn text={address} />
          </h1>
          <div className="row small" style={{ marginTop: 4 }}>
            {seed && (
              <span className="tag accent" title={tr('Data leaderboard Hyperliquid', 'Hyperliquid leaderboard data')}>
                {tr('Leaderboard: PnL 30h', 'Leaderboard: 30d PnL')} {fmtUsd(seed.pnl.month, { sign: true })} · all-time{' '}
                {fmtUsd(seed.pnl.allTime, { sign: true })}
              </span>
            )}
            <a href={`https://app.hyperliquid.xyz/explorer/address/${address}`} target="_blank" rel="noreferrer">
              {tr('Explorer Hyperliquid ↗', 'Hyperliquid Explorer ↗')}
            </a>
            <a href={`https://hypurrscan.io/address/${address}`} target="_blank" rel="noreferrer">
              Hypurrscan ↗
            </a>
          </div>
        </div>
        <div className="row">
          {watched ? (
            <>
              <input
                className="input"
                defaultValue={watched.label}
                placeholder={tr('Beri nama wallet ini', 'Name this wallet')}
                onBlur={(e) => watchlist.rename(address, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <button type="button" className="btn" onClick={() => watchlist.remove(address)}>
                {tr('Berhenti pantau', 'Unwatch')}
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" onClick={() => watchlist.add(address, seed?.displayName ?? '')}>
              {tr('Pantau & aktifkan alert', 'Watch & enable alerts')}
            </button>
          )}
        </div>
      </div>

      {errors.snap && <div className="notice error">{tr('Gagal memuat posisi', 'Failed to load positions')}: {errors.snap}</div>}

      <div className="cards">
        <StatCard
          label={tr('Nilai akun (perp)', 'Account value (perp)')}
          value={snap ? fmtUsd(snap.accountValue) : <Spinner />}
          sub={snap ? `Withdrawable ${fmtUsd(snap.withdrawable)}` : ''}
        />
        <StatCard
          label={tr('Total posisi', 'Total notional')}
          value={snap ? fmtUsd(totalNtl) : '–'}
          sub={
            snap && snap.accountValue > 0 ? (
              <>
                {tr('Leverage efektif', 'Effective leverage')} {(totalNtl / snap.accountValue).toFixed(2)}x ·{' '}
                <span className="pos">L {fmtUsd(longNtl)}</span> / <span className="neg">S {fmtUsd(totalNtl - longNtl)}</span>
              </>
            ) : (
              ''
            )
          }
        />
        <StatCard
          label={tr('uPnL terbuka', 'Open uPnL')}
          value={<Pnl v={totalPnl} />}
          sub={snap ? `${tr('Margin terpakai', 'Margin used')} ${fmtUsd(snap.marginUsed)}` : ''}
        />
        <StatCard
          label={tr(
            `PnL ${{ day: '24 jam', week: '7 hari', month: '30 hari', allTime: 'sepanjang waktu' }[win]}`,
            `${{ day: '24h', week: '7d', month: '30d', allTime: 'All-time' }[win]} PnL`,
          )}
          value={winPnl === null ? data.portfolio ? '–' : <Spinner /> : <Pnl v={winPnl} />}
          sub={portfolioWin ? `Volume ${fmtUsd(num(portfolioWin.vlm))}` : ''}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{mode === 'pnl' ? tr('Riwayat PnL', 'PnL history') : tr('Riwayat nilai akun', 'Account value history')}</h2>
          <div className="row">
            <Seg
              value={mode}
              onChange={setMode}
              options={[
                { value: 'pnl', label: 'PnL' },
                { value: 'equity', label: tr('Nilai akun', 'Account value') },
              ]}
            />
            <Seg<Win>
              value={win}
              onChange={setWin}
              options={[
                { value: 'day', label: tr('24j', '24h') },
                { value: 'week', label: tr('7h', '7d') },
                { value: 'month', label: tr('30h', '30d') },
                { value: 'allTime', label: tr('Semua', 'All') },
              ]}
            />
            <label className="check small">
              <input type="checkbox" checked={perpOnly} onChange={(e) => setPerpOnly(e.target.checked)} />{' '}
              {tr('Perp saja', 'Perp only')}
            </label>
          </div>
        </div>
        {errors.portfolio ? (
          <div className="notice error">{errors.portfolio}</div>
        ) : data.portfolio ? (
          <HistoryChart data={(mode === 'pnl' ? portfolioWin?.pnlHistory : portfolioWin?.accountValueHistory) ?? []} mode={mode} />
        ) : (
          <div className="chart-box sm">
            <div className="chart-overlay">
              <Spinner />
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <Tabs value={tab} tabs={tabs} onChange={openTab} />
        {tab === 'positions' && <PositionsTab positions={positions} loading={!snap} fills={data.fills} fillsError={errors.fills} />}
        {tab === 'chart' && <ChartTab positions={positions} fills={data.fills} />}
        {tab === 'orders' && <OrdersTab orders={data.orders} error={errors.orders} />}
        {tab === 'fills' && <FillsTab fills={data.fills} error={errors.fills} />}
        {tab === 'funding' && <FundingTab funding={funding.data} error={funding.error} />}
        {tab === 'ledger' && <LedgerTab ledger={ledger.data} error={ledger.error} address={address} />}
        {tab === 'spot' && <SpotTab spot={data.spot} error={errors.spot} />}
        {tab === 'stats' && <StatsTab fills={data.fills} error={errors.fills} />}
      </section>
    </div>
  );
}

function Loading({ error }: { error?: string }) {
  return error ? <div className="notice error">{error}</div> : <Empty><Spinner /> {tr('Memuat…', 'Loading…')}</Empty>;
}

function PositionsTab({
  positions,
  loading,
  fills,
  fillsError,
}: {
  positions: ReturnType<typeof toLive>[];
  loading: boolean;
  fills: HLFill[] | null;
  fillsError?: string;
}) {
  if (loading) return <Loading />;
  if (!positions.length) return <Empty>{tr('Wallet ini tidak punya posisi perp terbuka.', 'No open perp positions.')}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Coin</th>
            <th>{tr('Sisi', 'Side')}</th>
            <th className="num">Size</th>
            <th className="num">{tr('Nilai', 'Value')}</th>
            <th className="num">Entry</th>
            <th className="num">Mark</th>
            <th className="num">{tr('Likuidasi', 'Liq. price')}</th>
            <th className="num">{tr('Jarak', 'Liq. dist.')}</th>
            <th className="num">Leverage</th>
            <th className="num">Margin</th>
            <th
              title={tr(
                'Waktu posisi dibuka, dari fill pembuka (m = menit, j = jam, hr = hari)',
                'When the position was opened, from its opening fill (m = minutes, h = hours, d = days)',
              )}
            >
              {tr('Dibuka', 'Opened')}
            </th>
            <th title={tr('Fill terakhir di coin ini (tambah/kurangi posisi)', 'Last fill in this coin (add/reduce)')}>
              {tr('Fill terakhir', 'Last fill')}
            </th>
            <th className="num">uPnL (ROE)</th>
            <th
              className="num"
              title={tr(
                'Funding diterima (+) atau dibayar (−) sejak posisi dibuka',
                'Funding received (+) or paid (−) since the position opened',
              )}
            >
              Funding
            </th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr key={p.coin}>
              <td>
                <a className="coin-link" href={`#/coin/${encodeURIComponent(p.coin)}`}>
                  {p.coin}
                </a>
              </td>
              <td>
                <SideBadge side={p.side} />
              </td>
              <td className="num">{fmtSize(p.size)}</td>
              <td className="num">
                <b>{fmtUsd(p.notional)}</b>
              </td>
              <td className="num">{fmtPx(p.entryPx)}</td>
              <td className="num muted">{fmtPx(p.mark)}</td>
              <td className="num">{fmtPx(p.liquidationPx)}</td>
              <td className="num">
                <LiqDist d={p.liqDistance} />
              </td>
              <td className="num">
                {p.leverage}x <span className="dim small">{p.leverageType}</span>
              </td>
              <td className="num muted">{fmtUsd(p.marginUsed)}</td>
              {fills ? (
                <OpenCells info={findOpenTime(fills, p.coin, p.szi)} />
              ) : (
                <td colSpan={2} className="dim small">
                  {fillsError ? tr('riwayat fill gagal dimuat', 'fill history failed to load') : <Spinner />}
                </td>
              )}
              <td className="num">
                <Pnl v={p.livePnl} pct={p.liveRoe} />
              </td>
              <td className={`num ${pnlClass(p.fundingSinceOpen)}`}>{fmtUsd(p.fundingSinceOpen, { sign: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpenCells({ info }: { info: ReturnType<typeof findOpenTime> }) {
  return (
    <>
      <td className="small">
        <OpenedText info={info} />
      </td>
      <td className="small muted nowrap">{info.lastFillAt ? `${fmtShortDateTime(info.lastFillAt)} · ${fmtAge(info.lastFillAt)}` : '–'}</td>
    </>
  );
}

function ChartTab({ positions, fills }: { positions: ReturnType<typeof toLive>[]; fills: HLFill[] | null }) {
  useObservable(theme);
  const LEVEL = levelColors();
  const coins = useMemo(() => {
    const set = new Set(positions.map((p) => p.coin));
    for (const f of fills ?? []) if (!f.coin.startsWith('@') && !f.coin.includes('/')) set.add(f.coin);
    return [...set];
  }, [positions, fills]);
  const [coin, setCoin] = useState<string>('');
  const active = coin && coins.includes(coin) ? coin : coins[0];
  if (!active) {
    return fills ? (
      <Empty>{tr('Belum ada posisi atau trade perp untuk ditampilkan.', 'No perp positions or trades to show.')}</Empty>
    ) : (
      <Loading />
    );
  }

  const pos = positions.find((p) => p.coin === active);
  const lines: ChartLine[] = pos
    ? [
        { price: pos.entryPx, color: pos.side === 'long' ? LEVEL.long : LEVEL.short, title: `Entry ${pos.side.toUpperCase()}` },
        ...(pos.liquidationPx
          ? [{ price: pos.liquidationPx, color: LEVEL.liq, title: tr('Likuidasi', 'Liquidation'), dashed: true }]
          : []),
      ]
    : [];
  const markers: ChartMarker[] = (fills ?? [])
    .filter((f) => f.coin === active)
    .map((f) => ({ time: f.time, side: f.side === 'B' ? 'buy' : 'sell', text: fmtUsd(num(f.sz) * num(f.px), { decimals: 1 }) }));

  return (
    <div className="stack">
      <div className="row">
        <span className="muted small">Coin:</span>
        <select className="input" value={active} onChange={(e) => setCoin(e.target.value)}>
          {coins.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="dim small">
          {tr(
            `▲ beli · ▼ jual (dari ${fills?.length ?? 0} fill terakhir)`,
            `▲ buy · ▼ sell (last ${fills?.length ?? 0} fills)`,
          )}
        </span>
      </div>
      <div className="grid-chart">
        <PriceChart key={active} coin={active} lines={lines} markers={markers} />
        <NewsPanel key={active} coin={active} />
      </div>
    </div>
  );
}

/** "Harga di bawah 61,200.5": the API's condition text ("Price below 61200.5") in the interface language. */
function triggerText(condition: string | undefined, px: string | undefined): string {
  const c = condition ?? '';
  const price = fmtPx(num(px));
  if (/above/i.test(c)) return `${tr('Harga di atas', 'Price above')} ${price}`;
  if (/below/i.test(c)) return `${tr('Harga di bawah', 'Price below')} ${price}`;
  return c && c !== 'N/A' ? c : price;
}

function OrdersTab({ orders, error }: { orders: HLOpenOrder[] | null; error?: string }) {
  if (!orders) return <Loading error={error} />;
  if (!orders.length) return <Empty>{tr('Tidak ada open order.', 'No open orders.')}</Empty>;
  const sorted = [...orders].sort((a, b) => num(b.sz) * num(b.limitPx) - num(a.sz) * num(a.limitPx));
  return (
    <div className="table-wrap table-scroll">
      <table>
        <thead>
          <tr>
            <th>Coin</th>
            <th>{tr('Tipe', 'Type')}</th>
            <th>{tr('Sisi', 'Side')}</th>
            <th className="num">{tr('Harga', 'Price')}</th>
            <th className="num">Trigger</th>
            <th className="num">Size</th>
            <th className="num">{tr('Nilai', 'Value')}</th>
            <th>Info</th>
            <th>{tr('Dibuat', 'Placed')}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((o) => (
            <tr key={o.oid}>
              <td className="coin">{o.coin}</td>
              <td>{o.orderType ?? 'Limit'}</td>
              <td>
                <SideBadge side={o.side === 'B' ? 'buy' : 'sell'} />
              </td>
              <td className="num">{fmtPx(num(o.limitPx))}</td>
              <td className="num muted">{o.isTrigger ? triggerText(o.triggerCondition, o.triggerPx) : '–'}</td>
              <td className="num">
                {num(o.sz) ? fmtSize(num(o.sz)) : <span className="dim">{tr('seluruh posisi', 'entire position')}</span>}
              </td>
              <td className="num">
                <b>{num(o.sz) ? fmtUsd(num(o.sz) * num(o.limitPx)) : '–'}</b>
              </td>
              <td className="small">
                {o.reduceOnly && <span className="tag">reduce only</span>}{' '}
                {o.isPositionTpsl && <span className="tag">{tr('TP/SL posisi', 'position TP/SL')}</span>}
              </td>
              <td className="small nowrap" title={fmtDateTime(o.timestamp)}>
                {fmtShortDateTime(o.timestamp)} <span className="dim">{fmtAge(o.timestamp)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FILL_PAGE = 200;

function FillsTab({ fills, error }: { fills: HLFill[] | null; error?: string }) {
  const [coin, setCoin] = useState('all');
  const [minUsd, setMinUsd] = useState(0);
  const [limit, setLimit] = useState(FILL_PAGE);
  const coins = useMemo(() => [...new Set((fills ?? []).map((f) => f.coin))].sort(), [fills]);
  if (!fills) return <Loading error={error} />;
  if (!fills.length) return <Empty>{tr('Belum ada riwayat trade.', 'No trade history yet.')}</Empty>;
  const rows = fills.filter((f) => (coin === 'all' || f.coin === coin) && num(f.sz) * num(f.px) >= minUsd);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <select className="input" value={coin} onChange={(e) => setCoin(e.target.value)}>
          <option value="all">{tr('Semua coin', 'All coins')}</option>
          {coins.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="input" value={minUsd} onChange={(e) => setMinUsd(Number(e.target.value))}>
          {[0, 10_000, 100_000, 1_000_000].map((v) => (
            <option key={v} value={v}>
              {v ? `≥ ${fmtUsd(v, { decimals: 0 })}` : tr('Semua ukuran', 'All sizes')}
            </option>
          ))}
        </select>
        <span className="dim small">
          {tr(
            `${fills.length} fill terakhir (maks. 2000 dari API, fill per waktu digabung)`,
            `Last ${fills.length} fills (API max 2000, same-time fills merged)`,
          )}
        </span>
      </div>
      <div className="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr('Waktu', 'Time')}</th>
              <th>Coin</th>
              <th>{tr('Aksi', 'Action')}</th>
              <th className="num">{tr('Harga', 'Price')}</th>
              <th className="num">Size</th>
              <th className="num">{tr('Nilai', 'Value')}</th>
              <th className="num">{tr('PnL tertutup', 'Closed PnL')}</th>
              <th className="num">Fee</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((f) => {
              const pnl = num(f.closedPnl);
              const liq = !!f.liquidation || /liquidat/i.test(f.dir);
              return (
                <tr key={`${f.tid}-${f.time}`}>
                  <td className="muted small nowrap">{fmtDateTime(f.time)}</td>
                  <td className="coin">{f.coin}</td>
                  <td className={`nowrap ${f.side === 'B' ? 'pos' : 'neg'}`}>
                    {translateDir(f.dir)} {liq && <span className="tag danger">{tr('likuidasi', 'liquidation')}</span>}
                  </td>
                  <td className="num">{fmtPx(num(f.px))}</td>
                  <td className="num muted">{fmtSize(num(f.sz))}</td>
                  <td className="num">
                    <b>{fmtUsd(num(f.sz) * num(f.px))}</b>
                  </td>
                  <td className={`num ${pnlClass(pnl)}`}>{pnl ? fmtUsd(pnl, { sign: true }) : <span className="dim">–</span>}</td>
                  <td className="num dim">{fmtUsd(num(f.fee), { compact: false })}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn" onClick={() => setLimit(limit + FILL_PAGE)}>
            {tr(`Tampilkan lebih banyak (${rows.length - limit} tersisa)`, `Show more (${rows.length - limit} left)`)}
          </button>
        </div>
      )}
    </div>
  );
}

function FundingTab({ funding, error }: { funding: HLFundingEntry[] | null; error?: string }) {
  const byCoin = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of funding ?? []) m.set(f.delta.coin, (m.get(f.delta.coin) ?? 0) + num(f.delta.usdc));
    return [...m].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  }, [funding]);
  if (!funding) return <Loading error={error} />;
  if (!funding.length) {
    return (
      <Empty>
        {tr(
          `Tidak ada pembayaran funding dalam ${FUNDING_DAYS} hari terakhir.`,
          `No funding payments in the last ${FUNDING_DAYS} days.`,
        )}
      </Empty>
    );
  }
  const total = byCoin.reduce((t, [, v]) => t + v, 0);
  const rows = [...funding].sort((a, b) => b.time - a.time).slice(0, 500);
  return (
    <div className="grid-main">
      <div className="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr('Waktu', 'Time')}</th>
              <th>Coin</th>
              <th className="num">{tr('Size posisi', 'Position size')}</th>
              <th className="num">Rate</th>
              <th className="num">{tr('Jumlah', 'Amount')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f, i) => (
              <tr key={`${f.time}-${f.delta.coin}-${i}`}>
                <td className="muted small nowrap">{fmtDateTime(f.time)}</td>
                <td className="coin">{f.delta.coin}</td>
                <td className="num muted">{fmtSize(num(f.delta.szi))}</td>
                <td className="num muted">{fmtPct(num(f.delta.fundingRate), { decimals: 4 })}</td>
                <td className={`num ${pnlClass(num(f.delta.usdc))}`}>{fmtUsd(num(f.delta.usdc), { sign: true })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <div className="label">{tr(`Total funding ${FUNDING_DAYS} hari`, `Total funding ${FUNDING_DAYS}d`)}</div>
        <div className={`value ${pnlClass(total)}`}>{fmtUsd(total, { sign: true })}</div>
        <div className="sub">{tr('+ = diterima, − = dibayar', '+ = received, − = paid')}</div>
        <dl className="kv" style={{ marginTop: 12 }}>
          {byCoin.slice(0, 15).map(([c, v]) => (
            <FragmentKV key={c} k={c} v={<span className={pnlClass(v)}>{fmtUsd(v, { sign: true })}</span>} />
          ))}
        </dl>
      </div>
    </div>
  );
}

function FragmentKV({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

const ledgerLabel = (): Record<string, string> => ({
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  internalTransfer: tr('Transfer internal', 'Internal transfer'),
  subAccountTransfer: tr('Transfer sub-akun', 'Sub-account transfer'),
  accountClassTransfer: 'Perp ↔ Spot',
  spotTransfer: tr('Transfer spot', 'Spot transfer'),
  send: tr('Kirim', 'Send'),
  vaultDeposit: tr('Deposit ke vault', 'Vault deposit'),
  vaultWithdraw: tr('Tarik dari vault', 'Vault withdrawal'),
  vaultCreate: tr('Buat vault', 'Vault created'),
  vaultDistribution: tr('Distribusi vault', 'Vault distribution'),
  liquidation: tr('Likuidasi', 'Liquidation'),
  rewardsClaim: tr('Klaim reward', 'Reward claim'),
  cStakingTransfer: 'Staking',
  spotGenesis: 'Spot genesis',
});

function ledgerAmount(e: HLLedgerEntry, address: string): { usd: number; dir: 'in' | 'out' | '' ; detail: string } {
  const d = e.delta;
  const usd = num((d.usdc as string) ?? (d.usdcValue as string) ?? (d.amount as string));
  const dest = typeof d.destination === 'string' ? d.destination.toLowerCase() : '';
  const user = typeof d.user === 'string' ? d.user.toLowerCase() : '';
  switch (d.type) {
    case 'deposit':
    case 'vaultWithdraw':
    case 'rewardsClaim':
      return { usd, dir: 'in', detail: '' };
    case 'withdraw':
    case 'vaultDeposit':
      return { usd, dir: 'out', detail: typeof d.vault === 'string' ? `vault ${shortAddr(d.vault)}` : '' };
    case 'accountClassTransfer':
      return { usd, dir: '', detail: d.toPerp ? 'Spot → Perp' : 'Perp → Spot' };
    default:
      if (dest || user) {
        const incoming = dest === address;
        const other = incoming ? user : dest;
        const dirWord = incoming ? tr('dari', 'from') : tr('ke', 'to');
        return { usd, dir: incoming ? 'in' : 'out', detail: `${dirWord} ${shortAddr(other)}${d.token ? ` · ${d.token}` : ''}` };
      }
      return { usd, dir: '', detail: '' };
  }
}

function LedgerTab({ ledger, error, address }: { ledger: HLLedgerEntry[] | null; error?: string; address: string }) {
  if (!ledger) return <Loading error={error} />;
  if (!ledger.length) {
    return (
      <Empty>
        {tr(
          `Tidak ada deposit/withdraw/transfer dalam ${LEDGER_DAYS} hari terakhir.`,
          `No deposits/withdrawals/transfers in the last ${LEDGER_DAYS} days.`,
        )}
      </Empty>
    );
  }
  const rows = [...ledger].sort((a, b) => b.time - a.time);
  const labels = ledgerLabel();
  let dep = 0,
    wd = 0;
  for (const e of rows) {
    if (e.delta.type === 'deposit') dep += num(e.delta.usdc);
    if (e.delta.type === 'withdraw') wd += num(e.delta.usdc);
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row small">
        <span className="tag accent">Deposit {fmtUsd(dep)}</span>
        <span className="tag">Withdraw {fmtUsd(wd)}</span>
        <span className="dim">{tr(`${LEDGER_DAYS} hari terakhir`, `last ${LEDGER_DAYS} days`)}</span>
      </div>
      <div className="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr('Waktu', 'Time')}</th>
              <th>{tr('Jenis', 'Type')}</th>
              <th className="num">{tr('Jumlah (USD)', 'Amount (USD)')}</th>
              <th>Detail</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((e, i) => {
              const a = ledgerAmount(e, address);
              return (
                <tr key={`${e.hash}-${i}`}>
                  <td className="muted small nowrap">{fmtDateTime(e.time)}</td>
                  <td>{labels[e.delta.type] ?? e.delta.type}</td>
                  <td className={`num ${a.dir === 'in' ? 'pos' : a.dir === 'out' ? 'neg' : ''}`}>
                    {a.dir === 'in' ? '+' : a.dir === 'out' ? '−' : ''}
                    {fmtUsd(a.usd)}
                  </td>
                  <td className="small muted">{a.detail}</td>
                  <td className="small">
                    {e.hash && !/^0x0*$/.test(e.hash) ? (
                      <a href={`https://app.hyperliquid.xyz/explorer/tx/${e.hash}`} target="_blank" rel="noreferrer">
                        {shortAddr(e.hash)}
                      </a>
                    ) : (
                      '–'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SpotTab({ spot, error }: { spot: HLSpotBalance[] | null; error?: string }) {
  if (!spot) return <Loading error={error} />;
  const rows = spot.filter((b) => num(b.total) !== 0).sort((a, b) => num(b.entryNtl) - num(a.entryNtl));
  if (!rows.length) return <Empty>{tr('Tidak ada saldo spot.', 'No spot balances.')}</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th className="num">Total</th>
            <th className="num">{tr('Ditahan (order)', 'On hold (orders)')}</th>
            <th className="num">{tr('Nilai saat masuk', 'Entry value')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.coin}>
              <td className="coin">{b.coin}</td>
              <td className="num">{fmtSize(num(b.total))}</td>
              <td className="num muted">{fmtSize(num(b.hold))}</td>
              <td className="num">{b.coin === 'USDC' ? fmtUsd(num(b.total)) : num(b.entryNtl) ? fmtUsd(num(b.entryNtl)) : '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsTab({ fills, error }: { fills: HLFill[] | null; error?: string }) {
  const data = useMemo(() => {
    if (!fills) return null;
    const trips = roundTrips(fills);
    const byCoin = new Map<string, { trades: number; wins: number; pnl: number }>();
    for (const t of trips) {
      const c = byCoin.get(t.coin) ?? { trades: 0, wins: 0, pnl: 0 };
      c.trades++;
      if (t.pnl > 0) c.wins++;
      c.pnl += t.pnl;
      byCoin.set(t.coin, c);
    }
    return { basic: computeFillStats(fills), t: computeTraderStats(fills), trips: trips.sort((a, b) => b.closeAt - a.closeAt), byCoin };
  }, [fills]);
  if (!data) return <Loading error={error} />;
  const { basic: b, t } = data;
  if (!b.fills) return <Empty>{tr('Belum ada riwayat trade untuk dihitung.', 'No trade history to analyze yet.')}</Empty>;
  return (
    <div className="stack">
      <div className="notice info small">
        {tr(
          <>
            Dari {b.fills} fill terakhir ({fmtDateTime(b.firstTime)} – {fmtDateTime(b.lastTime)}), maksimal 2000 dari API. Satu
            trade = posisi dibuka sampai ditutup atau dibalik. Angka trade sebelum fee.
          </>,
          <>
            Last {b.fills} fills ({fmtDateTime(b.firstTime)} – {fmtDateTime(b.lastTime)}), API max 2000. One trade = a position
            from open to close or flip. Trade figures are before fees.
          </>,
        )}
      </div>
      <div className="cards">
        <StatCard
          label="Win rate"
          value={<span className={wrClass(t.winRate)}>{t.winRate === null ? '–' : fmtPct(t.winRate, { decimals: 1 })}</span>}
          sub={tr(
            `${t.wins} menang · ${t.losses} kalah · ${t.trades} trade`,
            `${plural(t.wins, 'win')} · ${plural(t.losses, 'loss', 'losses')} · ${plural(t.trades, 'trade')}`,
          )}
        />
        <StatCard
          label="Profit factor"
          value={<span className={pfClass(t.profitFactor)}>{fmtPF(t.profitFactor)}</span>}
          sub={<>Profit {fmtUsd(t.grossProfit)} ÷ {tr('rugi', 'loss')} {fmtUsd(t.grossLoss)}</>}
        />
        <StatCard
          label="Expectancy / trade"
          value={t.expectancy === null ? '–' : <Pnl v={t.expectancy} />}
          sub={
            t.tradesPerDay !== null
              ? tr(`${t.tradesPerDay.toFixed(1)} trade per hari`, `${t.tradesPerDay.toFixed(1)} trades per day`)
              : ''
          }
        />
        <StatCard
          label="Avg win / avg loss"
          value={
            <>
              <span className="pos">{fmtUsd(t.avgWin)}</span>
              <span className="dim"> / </span>
              <span className="neg">{fmtUsd(-t.avgLoss)}</span>
            </>
          }
          sub={`Payoff ratio ${t.payoff === null ? '–' : t.payoff.toFixed(2)}`}
        />
        <StatCard
          label="Best / worst trade"
          value={
            <>
              <Pnl v={t.bestTrade} />
              <span className="dim"> / </span>
              <Pnl v={t.worstTrade} />
            </>
          }
          sub={tr(
            `Streak terpanjang: ${t.maxWinStreak} menang · ${t.maxLossStreak} kalah`,
            `Longest streak: ${t.maxWinStreak} wins · ${t.maxLossStreak} losses`,
          )}
        />
        <StatCard
          label={tr('Lama pegang posisi', 'Hold time')}
          value={fmtSpan(t.avgHoldMs)}
          sub={tr('rata-rata per trade', 'average per trade')}
        />
        <StatCard
          label={tr('PnL terealisasi', 'Realized PnL')}
          value={<Pnl v={b.realizedPnl} />}
          sub={
            <>
              {tr('Setelah fee', 'After fees')}: <Pnl v={b.netPnl} />
            </>
          }
        />
        <StatCard
          label={tr('Volume · fee', 'Volume · fees')}
          value={fmtUsd(b.volume)}
          sub={`${tr('Fee', 'Fees')} ${fmtUsd(b.fees)}`}
        />
        <StatCard
          label="Bias"
          value={
            t.longShare === null ? (
              '–'
            ) : (
              <span className={t.longShare >= 0.5 ? 'pos' : 'neg'}>
                {t.longShare >= 0.5 ? `${Math.round(t.longShare * 100)}% LONG` : `${Math.round((1 - t.longShare) * 100)}% SHORT`}
              </span>
            )
          }
          sub={`${tr('Coin utama', 'Top coins')}: ${t.topCoins.join(', ') || '–'}`}
        />
        <StatCard
          label={tr('Kena likuidasi', 'Liquidated')}
          value={b.liquidations}
          tone={b.liquidations ? 'danger' : undefined}
          sub={tr('fill likuidasi', 'liquidation fills')}
        />
      </div>
      <div className="grid-2">
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Coin</th>
                <th className="num">Volume</th>
                <th className="num">{tr('Trade', 'Trades')}</th>
                <th className="num">Win rate</th>
                <th className="num">{tr('PnL trade', 'Trade PnL')}</th>
              </tr>
            </thead>
            <tbody>
              {b.byCoin.map((c) => {
                const tc = data.byCoin.get(c.coin);
                return (
                  <tr key={c.coin}>
                    <td className="coin">{c.coin}</td>
                    <td className="num">{fmtUsd(c.volume)}</td>
                    <td className="num muted">{tc?.trades ?? 0}</td>
                    <td className={`num ${wrClass(tc?.trades ? tc.wins / tc.trades : null)}`}>
                      {tc?.trades ? fmtPct(tc.wins / tc.trades, { decimals: 0 }) : '–'}
                    </td>
                    <td className={`num ${pnlClass(tc?.pnl ?? 0)}`}>{tc?.trades ? fmtUsd(tc.pnl, { sign: true }) : <span className="dim">–</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-wrap compact table-scroll" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th>{tr('Trade terakhir', 'Recent trades')}</th>
                <th>{tr('Sisi', 'Side')}</th>
                <th>{tr('Dibuka', 'Opened')}</th>
                <th className="num">{tr('Durasi', 'Duration')}</th>
                <th className="num">PnL</th>
              </tr>
            </thead>
            <tbody>
              {data.trips.slice(0, 50).map((rt) => (
                <tr key={`${rt.coin}-${rt.openAt}-${rt.closeAt}`}>
                  <td className="coin">{rt.coin}</td>
                  <td>
                    <SideBadge side={rt.side} />
                  </td>
                  <td
                    className="small nowrap"
                    title={tr(`Ditutup ${fmtDateTime(rt.closeAt)}`, `Closed ${fmtDateTime(rt.closeAt)}`)}
                  >
                    {fmtShortDateTime(rt.openAt)}
                  </td>
                  <td className="num muted">{fmtSpan(rt.closeAt - rt.openAt)}</td>
                  <td className={`num ${pnlClass(rt.pnl)}`}>{fmtUsd(rt.pnl, { sign: true })}</td>
                </tr>
              ))}
              {!data.trips.length && (
                <tr>
                  <td colSpan={5} className="dim">
                    {tr('Belum ada trade yang selesai dalam periode data.', 'No closed trades in the data period.')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
