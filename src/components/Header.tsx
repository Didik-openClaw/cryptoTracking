import { useState } from 'react';
import { limiter } from '../lib/api';
import { isAddress } from '../lib/format';
import { market } from '../lib/market';
import { useObservable } from '../lib/observable';
import { scanner } from '../lib/scanner';
import { watchlist } from '../lib/watchlist';
import { socket } from '../lib/ws';
import { go } from '../router';

const NAV = [
  { path: '', label: 'Scanner Whale' },
  { path: 'coins', label: 'Long vs Short' },
  { path: 'live', label: 'Live Trade Besar' },
  { path: 'watchlist', label: 'Watchlist & Alert' },
  { path: 'settings', label: 'Pengaturan' },
];

export function Header({ route }: { route: string[] }) {
  useObservable(socket);
  useObservable(scanner);
  useObservable(watchlist);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const current = route[0] ?? '';
  const active = (p: string) => p === current || (p === 'coins' && current === 'coin');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    if (isAddress(v)) go(`/wallet/${v.toLowerCase()}`);
    else {
      const coin = [...market.coins.keys()].find((c) => c.toLowerCase() === v.toLowerCase());
      if (coin) go(`/coin/${encodeURIComponent(coin)}`);
      else {
        setErr('Masukkan alamat wallet (0x + 40 karakter) atau nama coin, misalnya BTC.');
        return;
      }
    }
    setQ('');
    setErr('');
  };

  const wsCls = socket.status === 'open' ? 'ok' : socket.status === 'connecting' ? 'wait' : 'bad';
  const scanCls = scanner.status === 'scanning' ? 'ok' : scanner.status === 'seeding' ? 'wait' : 'bad';
  const paused = limiter.pausedFor > 0;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <a className="brand" href="#/">
          <img src="./favicon.svg" alt="" />
          <span>
            HL Whale Tracker
            <small>Pelacak posisi jumbo Hyperliquid</small>
          </span>
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.path} href={`#/${n.path}`} className={active(n.path) ? 'active' : ''}>
              {n.label}
              {n.path === 'watchlist' && watchlist.unread > 0 && <span className="badge-count">{watchlist.unread}</span>}
            </a>
          ))}
        </nav>
        <form className="search" onSubmit={submit}>
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setErr('');
            }}
            onBlur={() => setErr('')}
            placeholder="Cari alamat wallet 0x… atau coin (BTC)"
            aria-label="Cari wallet atau coin"
          />
          {err && <div className="search-err">{err}</div>}
        </form>
        <div className="conn">
          <span title="Koneksi websocket real-time ke Hyperliquid">
            <i className={`dot ${wsCls}`} />
            Live
          </span>
          <span title="Status scanner">
            <i className={`dot ${scanCls}`} />
            Scanner
          </span>
          {paused && (
            <span className="warn" title="Hyperliquid membalas 429, request dijeda sebentar">
              rate limit
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
