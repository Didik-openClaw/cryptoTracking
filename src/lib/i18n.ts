import { Fragment, createElement, type ReactNode } from 'react';
import { Observable, useObservable } from './observable';
import { load, save } from './storage';

/**
 * Interface language: Indonesian (default) or English.
 *
 * Text is written in place as a pair, `tr('Posisi', 'Positions')`, so both
 * languages sit next to each other in the code. Changing the language
 * remounts the React tree (<LangRoot>), so every component re-renders with
 * the new text; the background engines keep their data. `?lang=en` in the
 * URL picks a language too, for sharing links.
 */
export type Lang = 'id' | 'en';

const isLang = (v: unknown): v is Lang => v === 'id' || v === 'en';

function initial(): Lang {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (isLang(q)) {
      save('lang', q);
      return q;
    }
  } catch {
    /* not in a browser (tests) */
  }
  const saved = load<unknown>('lang', 'id');
  return isLang(saved) ? saved : 'id';
}

class Language extends Observable {
  lang: Lang = initial();

  constructor() {
    super(0);
    this.apply();
  }

  set(lang: Lang): void {
    if (lang === this.lang) return;
    this.lang = lang;
    save('lang', lang);
    this.apply();
    this.emit(true);
  }

  toggle(): void {
    this.set(this.lang === 'id' ? 'en' : 'id');
  }

  private apply(): void {
    if (typeof document !== 'undefined') document.documentElement.lang = this.lang;
  }
}

export const language = new Language();

/** The text (or element) for the current language. */
export function tr<T>(id: T, en: T): T {
  return language.lang === 'en' ? en : id;
}

export const isEn = () => language.lang === 'en';

/** English count with singular/plural noun: plural(1, 'wallet') → "1 wallet", plural(3, 'wallet') → "3 wallets". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** BCP 47 locale for counts and dates in the current language. */
export const locale = () => (language.lang === 'en' ? 'en-US' : 'id-ID');

/** Subscribe a component to language changes; returns the current language. */
export function useLang(): Lang {
  useObservable(language);
  return language.lang;
}

/** Remounts its children when the language changes, so all text is re-rendered. */
export function LangRoot({ children }: { children: ReactNode }) {
  const lang = useLang();
  return createElement(Fragment, { key: lang }, children);
}
