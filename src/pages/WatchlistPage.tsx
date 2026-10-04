import { useEffect, useMemo, useState } from 'react';
import { Addr } from '../components/Addr';
import { Empty, LongShortBar, Seg } from '../components/ui';
import { fmtAgo, fmtDateTime, fmtTime, fmtUsd, isAddress, pnlClass, shortAddr } from '../lib/format';
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
    if (!isAddress(a)) return setErr('Alamat harus 0x diikuti 40 karakter hex.');
    if (watchlist.has(a)) return setErr('Wallet ini sudah ada di watchlist.');
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
          <h1>Watchlist &amp; Alert</h1>
          <p>
            Pantau wallet whale favorit. Kamu akan dapat notifikasi saat mereka buka/tutup/tambah posisi, balik arah, atau
            posisinya mendekati likuidasi. {MAX_REALTIME_USERS} wallet teratas dipantau <b>real-time</b> lewat websocket, sisanya
            dicek setiap {s.watchPollSec} detik.
          </p>
        </div>
      </div>

      {perm !== 'granted' && perm !== 'unsupported' && (
        <div className="notice row" style={{ justifyContent: 'space-between' }}>
          <span>Izinkan notifikasi browser supaya alert tetap muncul walau tab ini tidak sedang dibuka.</span>
          <button type="button" className="btn sm primary" onClick={() => void notifier.requestPermission()}>
            Aktifkan notifikasi
          </button>
        </div>
      )}
      <div className="notice info small">
        Website ini berjalan sepenuhnya di browser kamu, jadi alert hanya aktif selama tab ini terbuka (boleh di background).
      </div>

      <section className="panel">
        <form className="filters" onSubmit={add}>
          <label className="field grow" style={{ minWidth: 280 }}>
            <span>Alamat wallet</span>
            <input className="input mono" value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="0x…" />
          </label>
          <label className="field" style={{ minWidth: 180 }}>
            <span>Nama / label (opsional)</span>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="mis. Paus BTC" />
          </label>
          <button type="submit" className="btn primary">
            + Tambah
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
              placeholder={'Tempel JSON hasil export, atau satu alamat per baris:\n0xabc… Paus BTC\n0xdef… Smart money'}
            />
            <div className="row">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const n = watchlist.importText(ioText);
                  setErr(n ? '' : 'Tidak ada alamat baru yang valid.');
                  if (n) setIoText('');
                }}
              >
                Import
              </button>
              <button type="button" className="btn" onClick={() => setIoText(watchlist.exportJson())}>
                Export ke kotak teks
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="grid-main">
        <section className="panel">
          <div className="panel-head">
            <h2>Wallet dipantau ({watchlist.entries.length})</h2>
            <button type="button" className="btn sm" onClick={() => watchlist.refreshNow()}>
              ↻ Refresh semua
            </button>
          </div>
          {watchlist.entries.length ? (
            <div className="table-wrap compact">
              <table>
                <thead>
                  <tr>
                    <th>Wallet</th>
                    <th className="num">Nilai akun</th>
                    <th className="num">Posisi</th>
                    <th style={{ width: 110 }}>Long / Short</th>
                    <th>Posisi terbesar</th>
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
                              placeholder={`Nama untuk ${shortAddr(e.address)}`}
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
                              <span className="tag accent" title="Trade dipantau lewat websocket secara instan">real-time</span>
                            ) : (
                              <span className="tag" title={`Dicek setiap ${s.watchPollSec} detik`}>polling</span>
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
                            <span className="dim">tidak ada</span>
                          ) : (
                            ''
                          )}
                        </td>
                        <td className={`num ${pnlClass(pnl)}`}>{snap ? fmtUsd(pnl, { sign: true }) : ''}</td>
                        <td className="num dim small">{snap ? fmtAgo(snap.updatedAt) : ''}</td>
                        <td className="nowrap right">
                          <button type="button" className="icon-btn" title="Naikkan" onClick={() => watchlist.move(e.address, -1)}>
                            ↑
                          </button>
                          <button type="button" className="icon-btn" title="Turunkan" onClick={() => watchlist.move(e.address, 1)}>
                            ↓
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Ganti nama"
                            onClick={() => setRenaming(e.address)}
                          >
                            ✎
                          </button>
                          <button type="button" className="icon-btn" title="Hapus" onClick={() => watchlist.remove(e.address)}>
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
              <b>Watchlist masih kosong.</b>
              <br />
              Tambahkan alamat di atas, atau klik ☆ di samping wallet mana pun di Scanner / Live feed.
            </Empty>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Log alert</h2>
            <button type="button" className="btn sm ghost" onClick={() => watchlist.clearAlerts()}>
              Hapus
            </button>
          </div>
          <div style={{ marginBottom: 10 }}>
            <Seg<AlertFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'Semua' },
                { value: 'trade', label: 'Trade' },
                { value: 'position', label: 'Posisi' },
                { value: 'liq', label: 'Likuidasi' },
                { value: 'whale', label: 'Whale baru' },
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
            <Empty>Belum ada alert.</Empty>
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
        PENGATURAN ALERT
      </h3>
      <label className="check">
        <input type="checkbox" checked={s.alertTrades} onChange={(e) => settings.update({ alertTrades: e.target.checked })} />
        Setiap trade wallet yang dipantau
      </label>
      <label className="check">
        <input type="checkbox" checked={s.alertPositionChanges} onChange={(e) => settings.update({ alertPositionChanges: e.target.checked })} />
        Buka / tutup / ubah posisi ≥
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
        Posisi dekat likuidasi &lt;
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
        % dari harga
      </label>
      <label className="check">
        <input type="checkbox" checked={s.alertNewWhale} onChange={(e) => settings.update({ alertNewWhale: e.target.checked })} />
        Whale baru dari scanner (posisi ≥ {fmtUsd(s.alertNewWhaleMinUsd, { decimals: 0 })})
      </label>
      <label className="check">
        <input type="checkbox" checked={s.alertSound} onChange={(e) => settings.update({ alertSound: e.target.checked })} />
        Bunyi
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={s.browserNotifications}
          onChange={(e) => settings.update({ browserNotifications: e.target.checked })}
        />
        Notifikasi browser
      </label>
    </div>
  );
}
