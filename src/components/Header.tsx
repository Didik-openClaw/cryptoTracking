import { useEffect, useRef, useState } from 'react';
import { limiter } from '../lib/api';
import { fmtPct, fmtPx, isAddress, pnlClass } from '../lib/format';
import { market } from '../lib/market';
import { useObservable } from '../lib/observable';
import { scanner } from '../lib/scanner';
import { watchlist } from '../lib/watchlist';
import { tr } from '../lib/i18n';
import { themeLabel, theme } from '../lib/theme';
import { AccessChip } from './AccessChip';
import { LangButton } from './LangButton';
import { socket } from '../lib/ws';
import { go } from '../router';

/** Numbered functions, Bloomberg style: press the digit or type the code. */
export const FUNCTIONS = [
  { path: '', code: 'WHAL', label: () => tr('Scanner Whale', 'Whale Scanner') },
  { path: 'coins', code: 'LSHT', label: () => 'Long vs Short' },
  { path: 'top', code: 'TOPW', label: () => 'Top Whale' },
  { path: 'live', code: 'BLKT', label: () => tr('Trade Besar', 'Block Trades') },
  { path: 'watchlist', code: 'WTCH', label: () => 'Watchlist' },
  { path: 'settings', code: 'PREF', label: () => tr('Pengaturan', 'Settings') },
];

const CLOCKS = [
  { label: 'JKT', tz: 'Asia/Jakarta' },
  { label: 'UTC', tz: 'UTC' },
  { label: 'NY', tz: 'America/New_York' },
];

function Clocks() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="clocks" aria-label={tr('Jam pasar', 'Market clocks')}>
      {CLOCKS.map((c) => (
        <span key={c.label}>
          <b>{c.label}</b>
          {now.toLocaleTimeString('en-GB', { timeZone: c.tz, hour12: false })}
        </span>
      ))}
    </div>
  );
}

/** Scrolling price tape of the most traded perps. */
function Tape() {
  useObservable(market);
  const coins = market.topCoins(14);
  if (!coins.length) return <div className="tape" />;
  const items = (copy: string) =>
    coins.map((c) => {
      const info = market.coins.get(c)!;
      const px = market.mids.get(c) ?? info.mark;
      const chg = info.prevDayPx ? px / info.prevDayPx - 1 : 0;
      return (
        <a key={c + copy} className="tape-item" href={`#/coin/${encodeURIComponent(c)}`} style={{ color: 'inherit' }} tabIndex={copy ? -1 : 0}>
          <b>{c}</b>
          {fmtPx(px)} <span className={pnlClass(chg)}>{fmtPct(chg, { sign: true })}</span>
        </a>
      );
    });
  return (
    <div className="tape" aria-label={tr('Harga perp teratas', 'Top perp prices')}>
      {/* The list is rendered twice so the scrolling loop is seamless. */}
      <div className="tape-track">
        {items('')}
        <span aria-hidden="true" style={{ display: 'contents' }}>
          {items('-2')}
        </span>
      </div>
    </div>
  );
}

export function Header({ route }: { route: string[] }) {
  useObservable(socket);
  useObservable(scanner);
  useObservable(watchlist);
  useObservable(theme);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const current = route[0] ?? '';
  const active = (p: string) => p === current || (p === 'coins' && current === 'coin');

  // Digits open a function, "/" focuses the command line (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === '/') {
        e.preventDefault();
        input.current?.focus();
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= FUNCTIONS.length) go(`/${FUNCTIONS[n - 1].path}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    const fn = FUNCTIONS.find((f, i) => f.code === v.toUpperCase() || String(i + 1) === v);
    const coin = [...market.coins.keys()].find((c) => c.toLowerCase() === v.toLowerCase());
    if (isAddress(v)) go(`/wallet/${v.toLowerCase()}`);
    else if (fn) go(`/${fn.path}`);
    else if (coin) go(`/coin/${encodeURIComponent(coin)}`);
    else {
      const codes = FUNCTIONS.map((f) => f.code).join(', ');
      setErr(
        tr(
          `Tidak dikenal. Ketik alamat 0x… (40 karakter), nama coin (BTC), atau kode fungsi (${codes}).`,
          `Not recognized. Type a 0x… address (40 characters), a coin (BTC) or a function code (${codes}).`,
        ),
      );
      return;
    }
    setQ('');
    setErr('');
    input.current?.blur();
  };

  const wsCls = socket.status === 'open' ? 'ok' : socket.status === 'connecting' ? 'wait' : 'bad';
  const scanCls = scanner.status === 'scanning' ? 'ok' : scanner.status === 'seeding' ? 'wait' : 'bad';

  return (
    <header className="term-head">
      <div className="cmdbar">
        <a className="brand" href="#/">
          <span className="logo">DTY</span>Crypto Terminal
        </a>
        <form className="cmd" onSubmit={submit}>
          <span className="prompt">&gt;</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setErr('');
            }}
            onBlur={() => setErr('')}
            placeholder={tr(
              'Alamat 0x…, coin (BTC) atau fungsi (WHAL) lalu GO   ·   tekan / untuk mengetik',
              '0x… address, coin (BTC) or function (WHAL) then GO   ·   press / to type',
            )}
            aria-label={tr('Command line: alamat wallet, coin, atau kode fungsi', 'Command line: wallet address, coin or function code')}
            spellCheck={false}
            autoCapitalize="characters"
          />
          <button type="submit" className="go">
            GO
          </button>
          {err && <div className="search-err">{err}</div>}
        </form>
        <Clocks />
        <AccessChip />
        <button
          type="button"
          className="theme-btn"
          onClick={() => theme.cycle()}
          title={tr('Ganti tema: Gelap → Terang → Auto (ikuti perangkat)', 'Change theme: Dark → Light → Auto (follow device)')}
          aria-label={tr(`Tema: ${themeLabel(theme.pref)}. Klik untuk ganti.`, `Theme: ${themeLabel(theme.pref)}. Click to change.`)}
        >
          <span className="theme-icon" aria-hidden="true" />
          {themeLabel(theme.pref)}
        </button>
        <LangButton />
        <div className="conn">
          <span title={tr('Websocket real-time Hyperliquid', 'Hyperliquid real-time websocket')}>
            <i className={`dot ${wsCls}`} />
            LIVE
          </span>
          <span title={tr('Status scanner', 'Scanner status')}>
            <i className={`dot ${scanCls}`} />
            SCAN
          </span>
          {limiter.pausedFor > 0 && (
            <span className="warn" title={tr('Hyperliquid membalas 429, request dijeda sebentar', 'Hyperliquid answered 429; requests are paused briefly')}>
              RATE LIMIT
            </span>
          )}
        </div>
      </div>
      <nav className="fnbar" aria-label={tr('Fungsi', 'Functions')}>
        {FUNCTIONS.map((f, i) => (
          <a key={f.code} href={`#/${f.path}`} className={active(f.path) ? 'on' : ''} title={tr(`Tekan ${i + 1}`, `Press ${i + 1}`)}>
            <b>{i + 1})</b>
            <span className="code">{f.code}</span>
            {f.label()}
            {f.path === 'watchlist' && watchlist.unread > 0 && <span className="badge-count">{watchlist.unread}</span>}
          </a>
        ))}
      </nav>
      <Tape />
    </header>
  );
}
