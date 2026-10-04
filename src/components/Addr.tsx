import { useState } from 'react';
import { shortAddr } from '../lib/format';
import { useObservable } from '../lib/observable';
import { watchlist } from '../lib/watchlist';

export function WatchStar({ address }: { address: string }) {
  useObservable(watchlist);
  const on = watchlist.has(address);
  return (
    <button
      type="button"
      className={`icon-btn${on ? ' on' : ''}`}
      title={on ? 'Hapus dari watchlist' : 'Tambah ke watchlist (alert)'}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        if (on) watchlist.remove(address);
        else watchlist.add(address);
      }}
    >
      {on ? '★' : '☆'}
    </button>
  );
}

export function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      title="Salin alamat"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard?.writeText(text).then(
          () => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          },
          () => {
            /* clipboard refused (some embedded views); the full address is in the link title */
          },
        );
      }}
    >
      {done ? '✓' : '⧉'}
    </button>
  );
}

/** Wallet reference: label (watchlist name or leaderboard display name) + short address. */
export function Addr({ address, star = true, copy = false }: { address: string; star?: boolean; copy?: boolean }) {
  useObservable(watchlist);
  const label = watchlist.labelOf(address);
  return (
    <span className="addr">
      {star && <WatchStar address={address} />}
      <a href={`#/wallet/${address}`} title={address} onClick={(e) => e.stopPropagation()}>
        {label && <span className="label">{label} </span>}
        <span className="hex">{shortAddr(address)}</span>
      </a>
      {copy && <CopyBtn text={address} />}
    </span>
  );
}
