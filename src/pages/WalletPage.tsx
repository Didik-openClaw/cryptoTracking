import { useEffect, useMemo, useState } from 'react';
import { CopyBtn } from '../components/Addr';
import { OpenedText } from '../components/Opened';
import { HistoryChart, LEVEL_COLORS, PriceChart, type ChartLine, type ChartMarker } from '../components/Charts';
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
import { market } from '../lib/market';
import { useObservable } from '../lib/observable';
import { fillsService } from '../lib/fills';
import { findOpenTime, openTimes } from '../lib/openTimes';
import { parseClearinghouse, toLive } from '../lib/positions';
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
  if (!isAddress(address)) return <Empty>Alamat tidak valid: {raw}</Empty>;
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
    { id: 'positions', label: 'Posisi', count: positions.length },
    { id: 'chart', label: 'Chart Trade' },
    { id: 'orders', label: 'Open Order', count: data.orders?.length },
    { id: 'fills', label: 'Riwayat Trade', count: data.fills?.length },
    { id: 'funding', label: 'Funding' },
    { id: 'ledger', label: 'Deposit & Transfer' },
    { id: 'spot', label: 'Spot' },
    { id: 'stats', label: 'Statistik' },
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
              <span className="tag accent" title="Data leaderboard Hyperliquid">
                Leaderboard: PnL 30h {fmtUsd(seed.pnl.month, { sign: true })} · all-time {fmtUsd(seed.pnl.allTime, { sign: true })}
              </span>
            )}
            <a href={`https://app.hyperliquid.xyz/explorer/address/${address}`} target="_blank" rel="noreferrer">
              Explorer Hyperliquid ↗
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
                placeholder="Beri nama wallet ini"
                onBlur={(e) => watchlist.rename(address, e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <button type="button" className="btn" onClick={() => watchlist.remove(address)}>
                Berhenti pantau
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" onClick={() => watchlist.add(address, seed?.displayName ?? '')}>
              Pantau &amp; aktifkan alert
            </button>
          )}
        </div>
      </div>

      {errors.snap && <div className="notice error">Gagal memuat posisi: {errors.snap}</div>}

      <div className="cards">
        <StatCard label="Nilai akun (perp)" value={snap ? fmtUsd(snap.accountValue) : <Spinner />} sub={snap ? `Withdrawable ${fmtUsd(snap.withdrawable)}` : ''} />
        <StatCard
          label="Total posisi"
          value={snap ? fmtUsd(totalNtl) : '–'}
          sub={
            snap && snap.accountValue > 0 ? (
              <>
                Leverage efektif {(totalNtl / snap.accountValue).toFixed(2)}x ·{' '}
                <span className="pos">L {fmtUsd(longNtl)}</span> / <span className="neg">S {fmtUsd(totalNtl - longNtl)}</span>
              </>
            ) : (
              ''
            )
          }
        />
        <StatCard label="uPnL terbuka" value={<Pnl v={totalPnl} />} sub={snap ? `Margin terpakai ${fmtUsd(snap.marginUsed)}` : ''} />
        <StatCard
          label={`PnL ${{ day: '24 jam', week: '7 hari', month: '30 hari', allTime: 'sepanjang waktu' }[win]}`}
          value={winPnl === null ? data.portfolio ? '–' : <Spinner /> : <Pnl v={winPnl} />}
          sub={portfolioWin ? `Volume ${fmtUsd(num(portfolioWin.vlm))}` : ''}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{mode === 'pnl' ? 'Riwayat PnL' : 'Riwayat nilai akun'}</h2>
          <div className="row">
            <Seg value={mode} onChange={setMode} options={[{ value: 'pnl', label: 'PnL' }, { value: 'equity', label: 'Nilai akun' }]} />
            <Seg<Win>
              value={win}
              onChange={setWin}
              options={[
                { value: 'day', label: '24j' },
                { value: 'week', label: '7h' },
                { value: 'month', label: '30h' },
                { value: 'allTime', label: 'Semua' },
              ]}
            />
            <label className="check small">
              <input type="checkbox" checked={perpOnly} onChange={(e) => setPerpOnly(e.target.checked)} /> Perp saja
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
  return error ? <div className="notice error">{error}</div> : <Empty><Spinner /> Memuat…</Empty>;
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
  if (!positions.length) return <Empty>Wallet ini tidak punya posisi perp terbuka.</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Coin</th>
            <th>Sisi</th>
            <th className="num">Size</th>
            <th className="num">Nilai</th>
            <th className="num">Entry</th>
            <th className="num">Mark</th>
            <th className="num">Likuidasi</th>
            <th className="num">Jarak</th>
            <th className="num">Leverage</th>
            <th className="num">Margin</th>
            <th title="Waktu posisi dibuka, dari fill pembuka (m = menit, j = jam, hr = hari)">Dibuka</th>
            <th title="Fill terakhir di coin ini (tambah/kurangi posisi)">Fill terakhir</th>
            <th className="num">uPnL (ROE)</th>
            <th className="num" title="Funding diterima (+) atau dibayar (−) sejak posisi dibuka">
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
                  {fillsError ? 'riwayat fill gagal dimuat' : <Spinner />}
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
  const coins = useMemo(() => {
    const set = new Set(positions.map((p) => p.coin));
    for (const f of fills ?? []) if (!f.coin.startsWith('@') && !f.coin.includes('/')) set.add(f.coin);
    return [...set];
  }, [positions, fills]);
  const [coin, setCoin] = useState<string>('');
  const active = coin && coins.includes(coin) ? coin : coins[0];
  if (!active) return fills ? <Empty>Belum ada posisi atau trade perp untuk ditampilkan.</Empty> : <Loading />;

  const pos = positions.find((p) => p.coin === active);
  const lines: ChartLine[] = pos
    ? [
        { price: pos.entryPx, color: pos.side === 'long' ? LEVEL_COLORS.long : LEVEL_COLORS.short, title: `Entry ${pos.side.toUpperCase()}` },
        ...(pos.liquidationPx ? [{ price: pos.liquidationPx, color: LEVEL_COLORS.liq, title: 'Likuidasi', dashed: true }] : []),
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
        <span className="dim small">▲ beli · ▼ jual (dari {fills?.length ?? 0} fill terakhir)</span>
      </div>
      <PriceChart key={active} coin={active} lines={lines} markers={markers} />
    </div>
  );
}

function OrdersTab({ orders, error }: { orders: HLOpenOrder[] | null; error?: string }) {
  if (!orders) return <Loading error={error} />;
  if (!orders.length) return <Empty>Tidak ada open order.</Empty>;
  const sorted = [...orders].sort((a, b) => num(b.sz) * num(b.limitPx) - num(a.sz) * num(a.limitPx));
  return (
    <div className="table-wrap table-scroll">
      <table>
        <thead>
          <tr>
            <th>Coin</th>
            <th>Tipe</th>
            <th>Sisi</th>
            <th className="num">Harga</th>
            <th className="num">Trigger</th>
            <th className="num">Size</th>
            <th className="num">Nilai</th>
            <th>Info</th>
            <th>Dibuat</th>
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
              <td className="num muted">{o.isTrigger ? `${o.triggerCondition ?? ''} ${fmtPx(num(o.triggerPx))}` : '–'}</td>
              <td className="num">{num(o.sz) ? fmtSize(num(o.sz)) : <span className="dim">seluruh posisi</span>}</td>
              <td className="num">
                <b>{num(o.sz) ? fmtUsd(num(o.sz) * num(o.limitPx)) : '–'}</b>
              </td>
              <td className="small">
                {o.reduceOnly && <span className="tag">reduce only</span>} {o.isPositionTpsl && <span className="tag">TP/SL posisi</span>}
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
  if (!fills.length) return <Empty>Belum ada riwayat trade.</Empty>;
  const rows = fills.filter((f) => (coin === 'all' || f.coin === coin) && num(f.sz) * num(f.px) >= minUsd);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row">
        <select className="input" value={coin} onChange={(e) => setCoin(e.target.value)}>
          <option value="all">Semua coin</option>
          {coins.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="input" value={minUsd} onChange={(e) => setMinUsd(Number(e.target.value))}>
          {[0, 10_000, 100_000, 1_000_000].map((v) => (
            <option key={v} value={v}>
              {v ? `≥ ${fmtUsd(v, { decimals: 0 })}` : 'Semua ukuran'}
            </option>
          ))}
        </select>
        <span className="dim small">{fills.length} fill terakhir (maks. 2000 dari API, fill per waktu digabung)</span>
      </div>
      <div className="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Coin</th>
              <th>Aksi</th>
              <th className="num">Harga</th>
              <th className="num">Size</th>
              <th className="num">Nilai</th>
              <th className="num">PnL tertutup</th>
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
                    {translateDir(f.dir)} {liq && <span className="tag danger">likuidasi</span>}
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
            Tampilkan lebih banyak ({rows.length - limit} tersisa)
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
  if (!funding.length) return <Empty>Tidak ada pembayaran funding dalam {FUNDING_DAYS} hari terakhir.</Empty>;
  const total = byCoin.reduce((t, [, v]) => t + v, 0);
  const rows = [...funding].sort((a, b) => b.time - a.time).slice(0, 500);
  return (
    <div className="grid-main">
      <div className="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Coin</th>
              <th className="num">Size posisi</th>
              <th className="num">Rate</th>
              <th className="num">Jumlah</th>
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
        <div className="label">Total funding {FUNDING_DAYS} hari</div>
        <div className={`value ${pnlClass(total)}`}>{fmtUsd(total, { sign: true })}</div>
        <div className="sub">+ = diterima, − = dibayar</div>
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

const LEDGER_LABEL: Record<string, string> = {
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  internalTransfer: 'Transfer internal',
  subAccountTransfer: 'Transfer sub-akun',
  accountClassTransfer: 'Perp ↔ Spot',
  spotTransfer: 'Transfer spot',
  send: 'Kirim',
  vaultDeposit: 'Deposit ke vault',
  vaultWithdraw: 'Tarik dari vault',
  vaultCreate: 'Buat vault',
  vaultDistribution: 'Distribusi vault',
  liquidation: 'Likuidasi',
  rewardsClaim: 'Klaim reward',
  cStakingTransfer: 'Staking',
  spotGenesis: 'Spot genesis',
};

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
        return { usd, dir: incoming ? 'in' : 'out', detail: `${incoming ? 'dari' : 'ke'} ${shortAddr(other)}${d.token ? ` · ${d.token}` : ''}` };
      }
      return { usd, dir: '', detail: '' };
  }
}

function LedgerTab({ ledger, error, address }: { ledger: HLLedgerEntry[] | null; error?: string; address: string }) {
  if (!ledger) return <Loading error={error} />;
  if (!ledger.length) return <Empty>Tidak ada deposit/withdraw/transfer dalam {LEDGER_DAYS} hari terakhir.</Empty>;
  const rows = [...ledger].sort((a, b) => b.time - a.time);
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
        <span className="dim">{LEDGER_DAYS} hari terakhir</span>
      </div>
      <div className="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              <th>Waktu</th>
              <th>Jenis</th>
              <th className="num">Jumlah (USD)</th>
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
                  <td>{LEDGER_LABEL[e.delta.type] ?? e.delta.type}</td>
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
  if (!rows.length) return <Empty>Tidak ada saldo spot.</Empty>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th className="num">Total</th>
            <th className="num">Ditahan (order)</th>
            <th className="num">Nilai saat masuk</th>
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
  if (!b.fills) return <Empty>Belum ada riwayat trade untuk dihitung.</Empty>;
  return (
    <div className="stack">
      <div className="notice info small">
        Dari {b.fills} fill terakhir ({fmtDateTime(b.firstTime)} – {fmtDateTime(b.lastTime)}), maksimal 2000 dari API. Satu
        trade = posisi dibuka sampai ditutup atau dibalik. Angka trade sebelum fee.
      </div>
      <div className="cards">
        <StatCard
          label="Win rate"
          value={<span className={wrClass(t.winRate)}>{t.winRate === null ? '–' : fmtPct(t.winRate, { decimals: 1 })}</span>}
          sub={`${t.wins} menang · ${t.losses} kalah · ${t.trades} trade`}
        />
        <StatCard
          label="Profit factor"
          value={<span className={pfClass(t.profitFactor)}>{fmtPF(t.profitFactor)}</span>}
          sub={<>Profit {fmtUsd(t.grossProfit)} ÷ rugi {fmtUsd(t.grossLoss)}</>}
        />
        <StatCard
          label="Expectancy / trade"
          value={t.expectancy === null ? '–' : <Pnl v={t.expectancy} />}
          sub={t.tradesPerDay !== null ? `${t.tradesPerDay.toFixed(1)} trade per hari` : ''}
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
          sub={`Streak terpanjang: ${t.maxWinStreak} menang · ${t.maxLossStreak} kalah`}
        />
        <StatCard label="Lama pegang posisi" value={fmtSpan(t.avgHoldMs)} sub="rata-rata per trade" />
        <StatCard label="PnL terealisasi" value={<Pnl v={b.realizedPnl} />} sub={<>Setelah fee: <Pnl v={b.netPnl} /></>} />
        <StatCard label="Volume · fee" value={fmtUsd(b.volume)} sub={`Fee ${fmtUsd(b.fees)}`} />
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
          sub={`Coin utama: ${t.topCoins.join(', ') || '–'}`}
        />
        <StatCard label="Kena likuidasi" value={b.liquidations} tone={b.liquidations ? 'danger' : undefined} sub="fill likuidasi" />
      </div>
      <div className="grid-2">
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Coin</th>
                <th className="num">Volume</th>
                <th className="num">Trade</th>
                <th className="num">Win rate</th>
                <th className="num">PnL trade</th>
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
                <th>Trade terakhir</th>
                <th>Sisi</th>
                <th>Dibuka</th>
                <th className="num">Durasi</th>
                <th className="num">PnL</th>
              </tr>
            </thead>
            <tbody>
              {data.trips.slice(0, 50).map((tr) => (
                <tr key={`${tr.coin}-${tr.openAt}-${tr.closeAt}`}>
                  <td className="coin">{tr.coin}</td>
                  <td>
                    <SideBadge side={tr.side} />
                  </td>
                  <td className="small nowrap" title={`Ditutup ${fmtDateTime(tr.closeAt)}`}>
                    {fmtShortDateTime(tr.openAt)}
                  </td>
                  <td className="num muted">{fmtSpan(tr.closeAt - tr.openAt)}</td>
                  <td className={`num ${pnlClass(tr.pnl)}`}>{fmtUsd(tr.pnl, { sign: true })}</td>
                </tr>
              ))}
              {!data.trips.length && (
                <tr>
                  <td colSpan={5} className="dim">
                    Belum ada trade yang selesai dalam periode data.
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
