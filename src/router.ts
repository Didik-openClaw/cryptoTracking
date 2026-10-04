import { useEffect, useState } from 'react';

/** Hash routing (#/wallet/0x…) works on any static host without rewrite rules. */
export function useRoute(): string[] {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash
    .replace(/^#\/?/, '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
}

export const go = (path: string) => {
  location.hash = path;
};
