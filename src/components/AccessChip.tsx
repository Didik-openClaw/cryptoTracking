import { access } from '../lib/access';
import { fmtCountdown, fmtDate, useNow } from '../lib/accessClient';
import { tr } from '../lib/i18n';
import { mode } from '../lib/mode';
import { useObservable } from '../lib/observable';

/** Where the demo's "buy" call to action points; empty hides it (e.g. in previews with no buy page). */
const BUY_URL: string = import.meta.env.VITE_BUY_URL ?? '/beli/';

const DAY = 86_400_000;

function Countdown() {
  const me = access.me!;
  const now = useNow(1000, access.offset);
  const left = me.exp - now;
  const tone = left < DAY ? 'danger' : left < 3 * DAY ? 'warn' : '';
  return (
    <a
      className={`access-chip ${tone}`}
      href="/beli/"
      title={tr(
        `${me.name} · akses sampai ${fmtDate(me.exp)} · klik untuk perpanjang`,
        `${me.name} · access until ${fmtDate(me.exp)} · click to renew`,
      )}
    >
      <b>{tr('AKSES', 'ACCESS')}</b>
      {fmtCountdown(left, true)}
    </a>
  );
}

/** Header chip: remaining paid access, or a buy link in the demo. */
export function AccessChip() {
  useObservable(access);
  if (mode.demo) {
    return BUY_URL ? (
      <a className="access-chip demo" href={BUY_URL}>
        <b>DEMO</b>
        {tr('Beli akses', 'Buy access')}
      </a>
    ) : null;
  }
  return access.status === 'active' && access.me ? <Countdown /> : null;
}
