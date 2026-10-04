import { useEffect, useState } from 'react';
import { fmtAgo, fmtPx, fmtSize, fmtUsd } from '../lib/format';
import type { LivePosition } from '../lib/types';
import { openTimes } from '../lib/openTimes';
import { Addr } from './Addr';
import { Opened } from './Opened';
import { Empty, LiqDist, Pnl, SideBadge, useSort } from './ui';

type Col = 'wallet' | 'coin' | 'side' | 'opened' | 'size' | 'notional' | 'entry' | 'mark' | 'liq' | 'dist' | 'lev' | 'pnl' | 'roe' | 'equity' | 'updated';

const getters: Record<Col, (p: LivePosition) => number | string> = {
  wallet: (p) => p.address,
  coin: (p) => p.coin,
  side: (p) => p.side,
  // Older first when ascending; unknown open times sort last.
  opened: (p) => {
    const info = openTimes.get(p.address, p.coin, p.side);
    return info?.openedAt ?? info?.before ?? NaN;
  },
  size: (p) => p.size,
  notional: (p) => p.notional,
  entry: (p) => p.entryPx,
  mark: (p) => p.mark,
  liq: (p) => p.liquidationPx ?? NaN,
  dist: (p) => p.liqDistance ?? NaN,
  lev: (p) => p.leverage,
  pnl: (p) => p.livePnl,
  roe: (p) => p.liveRoe,
  equity: (p) => p.accountValue,
  updated: (p) => p.updatedAt,
};

const PAGE = 200;
/** Open times are looked up for this many rows from the top of the current sort. */
const OPEN_TIME_ROWS = 40;

export function PositionsTable({
  rows,
  showWallet = true,
  showCoin = true,
  initialSort = 'notional',
  emptyText,
}: {
  rows: LivePosition[];
  showWallet?: boolean;
  showCoin?: boolean;
  initialSort?: Col;
  emptyText?: React.ReactNode;
}) {
  const { sorted, th } = useSort(rows, getters, initialSort, initialSort === 'dist' ? 'asc' : 'desc');
  const [limit, setLimit] = useState(PAGE);
  const now = Date.now();

  // Look up open times for the top rows (cached; fetched slowly in the background).
  useEffect(() => {
    for (const address of new Set(sorted.slice(0, Math.min(limit, OPEN_TIME_ROWS)).map((p) => p.address))) openTimes.request(address);
  }, [sorted, limit]);

  if (!rows.length) return <Empty>{emptyText ?? 'Belum ada posisi yang cocok dengan filter.'}</Empty>;

  return (
    <>
      <div className="table-wrap table-scroll">
        <table>
          <thead>
            <tr>
              {showWallet && th('wallet', 'Wallet')}
              {showCoin && th('coin', 'Coin')}
              {th('side', 'Sisi')}
              {th('opened', 'Dibuka', { title: 'Waktu posisi dibuka, dari fill pembuka (m = menit, j = jam, hr = hari)' })}
              {th('size', 'Size', { num: true })}
              {th('notional', 'Nilai Posisi', { num: true })}
              {th('entry', 'Entry', { num: true })}
              {th('mark', 'Mark', { num: true })}
              {th('liq', 'Harga Likuidasi', { num: true })}
              {th('dist', 'Jarak Liq.', { num: true, title: 'Seberapa jauh harga harus bergerak sampai posisi terlikuidasi' })}
              {th('lev', 'Leverage', { num: true })}
              {th('pnl', 'uPnL', { num: true })}
              {th('roe', 'ROE', { num: true })}
              {showWallet && th('equity', 'Equity Akun', { num: true })}
              {th('updated', 'Update', { num: true })}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((p) => (
              <tr key={`${p.address}|${p.coin}`}>
                {showWallet && (
                  <td>
                    <Addr address={p.address} />
                  </td>
                )}
                {showCoin && (
                  <td>
                    <a className="coin-link" href={`#/coin/${encodeURIComponent(p.coin)}`}>
                      {p.coin}
                    </a>
                  </td>
                )}
                <td>
                  <SideBadge side={p.side} />
                </td>
                <td className="small">
                  <Opened address={p.address} coin={p.coin} side={p.side} />
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
                  {p.leverage}x <span className="dim small">{p.leverageType === 'cross' ? 'cross' : 'iso'}</span>
                </td>
                <td className="num">
                  <Pnl v={p.livePnl} />
                </td>
                <td className="num">
                  <span className={p.liveRoe >= 0 ? 'pos' : 'neg'}>{(p.liveRoe * 100).toFixed(1)}%</span>
                </td>
                {showWallet && <td className="num muted">{fmtUsd(p.accountValue)}</td>}
                <td className="num dim small">{fmtAgo(p.updatedAt, now)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
          <button type="button" className="btn" onClick={() => setLimit(limit + PAGE)}>
            Tampilkan {Math.min(PAGE, sorted.length - limit)} lagi ({sorted.length - limit} tersisa)
          </button>
        </div>
      )}
    </>
  );
}
