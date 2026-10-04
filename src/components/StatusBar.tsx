import { apiStats, limiter } from '../lib/api';
import { fmtAgo, fmtUsd } from '../lib/format';
import { live } from '../lib/live';
import { mode } from '../lib/mode';
import { useObservable } from '../lib/observable';
import { scanner } from '../lib/scanner';
import { settings } from '../lib/settings';
import { socket } from '../lib/ws';

/** One-line system status pinned to the bottom of the screen. */
export function StatusBar() {
  useObservable(scanner);
  useObservable(socket);
  useObservable(live);
  const s = settings.value;
  const pass = scanner.pass;
  return (
    <footer className="statusbar">
      <span>
        <b>SRC</b>
        {mode.demo ? 'SIMULASI (demo)' : 'Hyperliquid mainnet'}
      </span>
      <span>
        <b>WS</b>
        {socket.status === 'open' ? 'ON' : socket.status === 'connecting' ? '…' : 'OFF'} · {live.coins.length} coin
      </span>
      <span>
        <b>SCAN</b>
        {pass.done.toLocaleString('en-US')}/{pass.total.toLocaleString('en-US')} · {scanner.scanRate}/mnt
      </span>
      <span className="opt">
        <b>WHALE</b>
        {scanner.livePositions(new Map(), s.minPositionUsd).length} posisi ≥ {fmtUsd(s.minPositionUsd, { decimals: 0 })}
      </span>
      <span className="opt">
        <b>REST</b>
        {apiStats.requests.toLocaleString('en-US')} req · antre {limiter.pending}
        {apiStats.rateLimited > 0 && ` · 429×${apiStats.rateLimited}`}
      </span>
      {scanner.restoredAt > 0 && pass.n <= 1 && (
        <span className="opt">
          <b>CACHE</b>
          {fmtAgo(scanner.restoredAt)}
        </span>
      )}
      <span className="sp dim">Data publik · bukan saran finansial</span>
    </footer>
  );
}
