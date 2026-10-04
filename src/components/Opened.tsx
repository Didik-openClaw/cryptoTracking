import { fmtAge, fmtDateTime, fmtShortDateTime } from '../lib/format';
import { tr } from '../lib/i18n';
import { useObservable } from '../lib/observable';
import { openTimes, type OpenInfo } from '../lib/openTimes';
import type { Side } from '../lib/types';

/** Open time of a position: "02 Okt 14:05 · 2h 5j" (date + age), or a bound when older than the fill window. */
export function OpenedText({ info, pending, compact }: { info?: Pick<OpenInfo, 'openedAt' | 'before' | 'lastFillAt'>; pending?: boolean; compact?: boolean }) {
  if (info?.openedAt) {
    const last =
      info.lastFillAt && info.lastFillAt !== info.openedAt
        ? tr(` · fill terakhir ${fmtDateTime(info.lastFillAt)}`, ` · last fill ${fmtDateTime(info.lastFillAt)}`)
        : '';
    return (
      <span className="nowrap" title={tr(`Dibuka ${fmtDateTime(info.openedAt)}${last}`, `Opened ${fmtDateTime(info.openedAt)}${last}`)}>
        {!compact && <>{fmtShortDateTime(info.openedAt)} </>}
        <span className={compact ? '' : 'dim'}>{fmtAge(info.openedAt)}</span>
      </span>
    );
  }
  if (info?.before) {
    return (
      <span
        className="nowrap dim"
        title={tr(
          `Dibuka sebelum ${fmtDateTime(info.before)}: lebih lama dari 2000 fill terakhir yang disediakan API`,
          `Opened before ${fmtDateTime(info.before)}: older than the last 2000 fills the API provides`,
        )}
      >
        &gt; {compact ? fmtAge(info.before) : fmtShortDateTime(info.before)}
      </span>
    );
  }
  if (pending) return <span className="dim" title={tr('Mencari fill pembuka posisi…', 'Looking for the opening fill…')}>…</span>;
  if (info)
    return (
      <span className="dim" title={tr('Fill pembuka tidak ditemukan di riwayat wallet', 'Opening fill not found in wallet history')}>
        ?
      </span>
    );
  return (
    <span
      className="dim"
      title={tr(
        'Belum dicek: otomatis untuk 40 baris teratas, atau buka detail wallet',
        'Not checked yet: automatic for the top 40 rows, or open the wallet detail',
      )}
    >
      –
    </span>
  );
}

/** Opened-at cell backed by the shared open-time cache. */
export function Opened({ address, coin, side, compact }: { address: string; coin: string; side: Side; compact?: boolean }) {
  useObservable(openTimes);
  return <OpenedText info={openTimes.get(address, coin, side)} pending={openTimes.isPending(address)} compact={compact} />;
}
