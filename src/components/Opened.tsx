import { fmtAge, fmtDateTime, fmtShortDateTime } from '../lib/format';
import { useObservable } from '../lib/observable';
import { openTimes, type OpenInfo } from '../lib/openTimes';
import type { Side } from '../lib/types';

/** Open time of a position: "02 Okt 14:05 · 2h 5j" (date + age), or a bound when older than the fill window. */
export function OpenedText({ info, pending, compact }: { info?: Pick<OpenInfo, 'openedAt' | 'before' | 'lastFillAt'>; pending?: boolean; compact?: boolean }) {
  if (info?.openedAt) {
    const last = info.lastFillAt && info.lastFillAt !== info.openedAt ? ` · fill terakhir ${fmtDateTime(info.lastFillAt)}` : '';
    return (
      <span className="nowrap" title={`Dibuka ${fmtDateTime(info.openedAt)}${last}`}>
        {!compact && <>{fmtShortDateTime(info.openedAt)} </>}
        <span className={compact ? '' : 'dim'}>{fmtAge(info.openedAt)}</span>
      </span>
    );
  }
  if (info?.before) {
    return (
      <span className="nowrap dim" title={`Dibuka sebelum ${fmtDateTime(info.before)}: lebih lama dari 2000 fill terakhir yang disediakan API`}>
        &gt; {compact ? fmtAge(info.before) : fmtShortDateTime(info.before)}
      </span>
    );
  }
  if (pending) return <span className="dim" title="Mencari fill pembuka posisi…">…</span>;
  if (info)
    return (
      <span className="dim" title="Fill pembuka tidak ditemukan di riwayat wallet">
        ?
      </span>
    );
  return (
    <span className="dim" title="Belum dicek: otomatis untuk 40 baris teratas, atau buka detail wallet">
      –
    </span>
  );
}

/** Opened-at cell backed by the shared open-time cache. */
export function Opened({ address, coin, side, compact }: { address: string; coin: string; side: Side; compact?: boolean }) {
  useObservable(openTimes);
  return <OpenedText info={openTimes.get(address, coin, side)} pending={openTimes.isPending(address)} compact={compact} />;
}
