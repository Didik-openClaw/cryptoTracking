import { access } from './access';
import { limiter } from './api';
import { live } from './live';
import { market } from './market';
import { news } from './news';
import { openTimes } from './openTimes';
import { scanner } from './scanner';
import { settings } from './settings';
import { watchlist } from './watchlist';
import { wire } from './wire';
import { socket } from './ws';

let started = false;

/** Start every background engine once; they keep running across page changes. */
export function startApp(): void {
  if (started) return;
  started = true;

  limiter.setRate(settings.value.rateBudget);
  let { scanLimit, minAccountValue } = settings.value;
  settings.subscribe(() => {
    const s = settings.value;
    limiter.setRate(s.rateBudget);
    // A different scan universe needs a fresh pass to take effect.
    if (s.scanLimit !== scanLimit || s.minAccountValue !== minAccountValue) {
      ({ scanLimit, minAccountValue } = s);
      scanner.restartPass();
    }
  });

  openTimes.setSource((address) => scanner.wallets.get(address));

  // Keep the latest results for the next visit.
  window.addEventListener('pagehide', () => scanner.persist());

  access.start();
  socket.start();
  market.start();
  live.start();
  watchlist.start();
  wire.start();
  news.start();
  void scanner.start();
}
