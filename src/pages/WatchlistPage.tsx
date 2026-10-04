import { useEffect, useMemo, useState } from 'react';
import { Addr } from '../components/Addr';
import { Empty, LongShortBar, Seg } from '../components/ui';
import { fmtAgo, fmtDateTime, fmtTime, fmtUsd, isAddress, pnlClass, shortAddr } from '../lib/format';
import { tr } from '../lib/i18n';
import { notifier } from '../lib/notify';
import { useObservable } from '../lib/observable';
import { settings } from '../lib/settings';
import { MAX_REALTIME_USERS, watchlist, type AlertItem } from '../lib/watchlist';

type AlertFilter = 'all' | 'trade' | 'position' | 'liq' | 'whale';
const FILTER_KINDS: Record<AlertFilter, AlertItem['kind'][] | null> = {
  all: null,
  trade: ['trade', 'bigtrade'],
  position: ['open', 'close', 'increase', 'decrease', 'flip'],
  liq: ['liq'],
  whale: ['whale'],
};

export function WatchlistPage() {
  useObservable(watchlist);
  useObservable(settings);
  useObservable(notifier);
  const s = settings.value;
  const [addr, setAddr] = useState('');
  const [label, setLabel] = useState('');
  const [err, setErr] = useState('');
  const [io, setIo] = useState(false);
  const [ioText, setIoText] = useState('');
  const [filter, setFilter] = useState<AlertFilter>('all');
  const [renaming, setRenaming] = useState<string | null>(null);

  // Opening this page counts as reading the alerts.
  useEffect(() => watchlist.markRead(), [watchlist.unread]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const a = addr.trim();
    if (!isAddress(a)) {
      return setErr(tr('Alamat harus 0x diikuti 40 karakter hex.', 'Address must be 0x followed by 40 hex characters.'));
    }
    if (watchlist.has(a)) return setErr(tr('Wallet ini sudah ada di watchlist.', 'This wallet is already on the watchlist.'));
    watchlist.add(a, label);
    setAddr('');
    setLabel('');
    setErr('');
  };

  const alerts = useMemo(() => {
    const kinds = FILTER_KINDS[filter];
    return kinds ? watchlist.alerts.filter((a) => kinds.includes(a.kind)) : watchlist.alerts;
  }, [watchlist.alerts, filter]);

  const perm = notifier.permission;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            <span className="fn">WTCH</span>
            {tr('Watchlist & Alert', 'Watchlist & Alerts')}
          </h1>
          <p>
            {tr(
              <>
                Alert saat wallet buka, tutup, tambah, atau balik posisi, dan saat posisi mendekati likuidasi.{' '}
                {MAX_REALTIME_USERS} wallet teratas real-time via websocket, sisanya dicek tiap {s.watchPollSec} detik.
              </>,
              <>
                Alerts when a wallet opens, closes, adds to or flips a position, and when a position nears liquidation. Top{' '}
                {MAX_REALTIME_USERS} wallets real-time via websocket, the rest polled every {s.watchPollSec}s.
              </>,
            )}
          </p>
        </div>
      </div>

      {perm !== 'granted' && perm !== 'unsupported' && (
        <div className="notice row" style={{ justifyContent: 'space-between' }}>
          <span>
            {tr(
              'Izinkan notifikasi browser supaya alert tetap muncul walau tab ini tidak sedang dibuka.',
              'Allow browser notifications so alerts still show when you are not on this tab.',
            )}
          </span>
          <button type="button" className="btn sm primary" onClick={() => void notifier.requestPermission()}>
            {tr('Aktifkan notifikasi', 'Enable notifications')}
          </button>
        </div>
      )}
      <div className="notice info small">
        {tr(
          'Website ini berjalan sepenuhnya di browser kamu, jadi alert hanya aktif selama tab ini terbuka (boleh di background).',
          'This site runs entirely in your browser, so alerts only work while this tab is open (background is fine).',
        )}
      </div>

      <section className="panel">
        <form className="filters" onSubmit={add}>
          <label className="field grow" style={{ minWidth: 280 }}>
            <span>{tr('Alamat wallet', 'Wallet address')}</span>
            <input className="input mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x…" />
          </label>
          <label className="field" style={{ minWidth: 180 }}>
            <span>{tr('Nama / label (opsional)', 'Name / label (optional)')}</span>
            <input
              className="input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={tr('mis. Paus BTC', 'e.g. BTC whale')}
            />
          </label>
          <button type="submit" className="btn primary">
            {tr('Tambah', 'Add')}
          </button>
          <button type="button" className="btn ghost" onClick={() => setIo(!io)}>
            Import / Export
          </button>
        </form>
        {err && <div className="small danger" style={{ marginTop: 6 }}>{err}</div>}
        {io && (
          <div className="stack" style={{ marginTop: 12, gap: 8 }}>
            <textarea
              className="input"
              value={ioText}
              onChange={(e) => setIoText(e.target.value)}
              placeholder={tr(
                'Tempel JSON hasil export, atau satu alamat per baris:\n0xabc… Paus BTC\n0xdef… Smart money',
                'Paste exported JSON, or one address per line:\n0xabc… BTC whale\n0xdef… Smart money',
              )}
            />
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const n = watchlist.importText(ioText);
                  setErr(n ? '' : tr('Tidak ada alamat baru yang valid.', 'No new valid addresses.'));
                  if (n) setIoText('');
                }}
              >
                Import
              </button>
              <button type="button" className="btn" onClick={() => setIoText(watchlist.exportJson())}>
                {tr('Export ke kotak teks', 'Export to text box')}
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="grid-main">
        <section className="panel">
          <div className="panel-head">
            <h2>
              {tr('Wallet dipantau', 'Watched wallets')} ({watchlist.entries.length})
            </h2>
            <button type="button" className="btn sm" onClick={() => watchlist.refreshNow()}>
              {tr('Refresh semua', 'Refresh all')}
            </button>
          </div>
          {watchlist.entries.length ? (
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th className="num">{tr('Nilai akun', 'Account value')}</th>
                    <th className="num">{tr('Posisi', 'Positions')}</th>
                    <th style={{ width: 110 }}>Long / Short</th>
                    <th>{tr('Posisi terbesar', 'Largest position')}</th>
                    <th className="num">uPnL</th>
                    <th className="num">Update</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {watchlist.entries.map((e, i) => {
                    const snap = watchlist.snapshots.get(e.address);
                    const error = watchlist.errors.get(e.address);
                    const long = snap?.positions.filter((p) => p.side === 'long').reduce((t, p) => t + p.positionValue, 0) ?? 0;
                    const short = snap?.positions.filter((p) => p.side === 'short').reduce((t, p) => t + p.positionValue, 0) ?? 0;
                    const pnl = snap?.positions.reduce((t, p) => t + p.unrealizedPnl, 0) ?? 0;
                    const top = snap?.positions[0];
                    return (
                      <tr key={e.address}>
                        <td>
                          {renaming === e.address ? (
                            <input
                              className="input"
                              autoFocus
                              defaultValue={e.label}
                              placeholder={tr(`Nama untuk ${shortAddr(e.address)}`, `Name for ${shortAddr(e.address)}`)}
                              onBlur={(ev) => {
                                watchlist.rename(e.address, ev.target.value);
                                setRenaming(null);
                              }}
                              onKeyDown={(ev) => {
                                if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur();
                                if (ev.key === 'Escape') setRenaming(null);
                              }}
                            />
                          ) : (
                            <Addr address={e.address} copy />
                          )}
                          <div>
                            {i < MAX_REALTIME_USERS ? (
                              <span
                                className="tag accent"
                                title={tr('Trade dipantau lewat websocket secara instan', 'Trades tracked instantly via websocket')}
                              >
                                real-time
                              </span>
                            ) : (
                              <span
                                className="tag"
                                title={tr(`Dicek setiap ${s.watchPollSec} detik`, `Polled every ${s.watchPollSec}s`)}
                              >
                                polling
                              </span>
                            )}
                          </div>
                          {error && <div className="small danger">{error}</div>}
                        </td>
                        <td className="num">{snap ? fmtUsd(snap.accountValue) : '…'}</td>
                        <td className="num">{snap ? fmtUsd(long + short) : '…'}</td>
                        <td>{snap && <LongShortBar long={long} short={short} />}</td>
                        <td className="nowrap">
                          {top ? (
                            <>
                              <span className={top.side === 'long' ? 'pos' : 'neg'}>{top.side === 'long' ? 'L' : 'S'}</span>{' '}
                              <b>{top.coin}</b> {fmtUsd(top.positionValue)}
                            </>
                          ) : snap ? (
                            <span className="dim">{tr('tidak ada', 'none')}</span>
                          ) : (
                            ''
                          )}
                        </td>
                        <td className={`num ${pnlClass(pnl)}`}>{snap ? fmtUsd(pnl, { sign: true }) : ''}</td>
                        <td className="num dim small">{snap ? fmtAgo(snap.updatedAt) : ''}</td>
                        <td className="nowrap right">
                          <button
                            type="button"
                            className="icon-btn"
                            title={tr('Naikkan', 'Move up')}
                            onClick={() => watchlist.move(e.address, -1)}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title={tr('Turunkan', 'Move down')}
                            onClick={() => watchlist.move(e.address, 1)}
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title={tr('Ganti nama', 'Rename')}
                            onClick={() => setRenaming(e.address)}
                          >
                            ✎
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title={tr('Hapus', 'Remove')}
                            onClick={() => watchlist.remove(e.address)}
                          >
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
              <b>{tr('Watchlist masih kosong.', 'Watchlist is empty.')}</b>
              <br />
              {tr(
                'Tambahkan alamat di atas, atau klik ☆ di samping wallet mana pun di Scanner / Live feed.',
                'Add an address above, or click ☆ next to any wallet in the Scanner / Live feed.',
              )}
            </Empty>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{tr('Log alert', 'Alert log')}</h2>
            <button type="button" className="btn sm ghost" onClick={() => watchlist.clearAlerts()}>
              {tr('Hapus', 'Clear')}
            </button>
          </div>
          <div style={{ marginBottom: 10 }}>
            <Seg<AlertFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: tr('Semua', 'All') },
                { value: 'trade', label: tr('Trade', 'Trades') },
                { value: 'position', label: tr('Posisi', 'Positions') },
                { value: 'liq', label: tr('Likuidasi', 'Liquidations') },
                { value: 'whale', label: tr('Whale baru', 'New whales') },
              ]}
            />
          </div>
          {alerts.length ? (
            <div className="alert-list table-scroll" style={{ maxHeight: 640 }}>
              {alerts.map((a) => (
                <div key={a.id} className={`alert-item ${a.severity}`}>
                  <div className="t" title={fmtDateTime(a.time)}>
                    {Date.now() - a.time < 86_400_000 ? fmtTime(a.time) : fmtDateTime(a.time)}
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="title">{a.title}</div>
                    <div className="small muted">{a.body}</div>
                    <div className="small">
                      <Addr address={a.address} star={false} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>{tr('Belum ada alert.', 'No alerts yet.')}</Empty>
          )}
          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '14px 0' }} />
          <AlertSettings />
        </section>
      </div>
    </div>
  );
}

export function AlertSettings() {
  const s = settings.value;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <h3 className="small muted" style={{ margin: 0 }}>
        {tr('PENGATURAN ALERT', 'ALERT SETTINGS')}
      </h3>
      <label className="check">
        <input type="checkbox" checked={s.alertTrades} onChange={(e) => settings.update({ alertTrades: e.target.checked })} />
        {tr('Setiap trade wallet yang dipantau', 'Every trade by watched wallets')}
      </label>
      <label className="check">
        <input type="checkbox" checked={s.alertPositionChanges} onChange={(e) => settings.update({ alertPositionChanges: e.target.checked })} />
        {tr('Buka / tutup / ubah posisi ≥', 'Open / close / resize position ≥')}
        <input
          className="input"
          type="number"
          min={1}
          max={100}
          style={{ width: 64 }}
          value={s.alertSizeChangePct}
          onChange={(e) => settings.update({ alertSizeChangePct: Math.max(1, Number(e.target.value) || 10) })}
        />
        %
      </label>
      <label className="check">
        {tr('Posisi dekat likuidasi <', 'Position near liquidation <')}
        <input
          className="input"
          type="number"
          min={0.5}
          max={50}
          step={0.5}
          style={{ width: 64 }}
          value={s.alertLiqPct}
          onChange={(e) => settings.update({ alertLiqPct: Math.max(0.5, Number(e.target.value) || 5) })}
        />
        {tr('% dari harga', '% from price')}
      </label>
      <label className="check">
        <input type="checkbox" checked={s.alertNewWhale} onChange={(e) => settings.update({ alertNewWhale: e.target.checked })} />
        {tr(
          `Whale baru dari scanner (posisi ≥ ${fmtUsd(s.alertNewWhaleMinUsd, { decimals: 0 })})`,
          `New whales from scanner (position ≥ ${fmtUsd(s.alertNewWhaleMinUsd, { decimals: 0 })})`,
        )}
      </label>
      <label className="check">
        <input type="checkbox" checked={s.alertSound} onChange={(e) => settings.update({ alertSound: e.target.checked })} />
        {tr('Bunyi', 'Sound')}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={s.browserNotifications}
          onChange={(e) => settings.update({ browserNotifications: e.target.checked })}
        />
        {tr('Notifikasi browser', 'Browser notifications')}
      </label>
    </div>
  );
}
