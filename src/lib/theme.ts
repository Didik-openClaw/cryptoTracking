import { tr } from './i18n';
import { Observable } from './observable';
import { load, save } from './storage';

/**
 * Colour theme. "auto" follows the host page's explicit choice (an embedding
 * viewer may set data-theme on <html>) and otherwise the device setting.
 * The resolved mode is written to <html data-mode>, which styles.css keys on.
 */
export type ThemePref = 'dark' | 'light' | 'auto';
export type ThemeMode = 'dark' | 'light';

export const themeLabel = (pref: ThemePref) => ({ dark: tr('Gelap', 'Dark'), light: tr('Terang', 'Light'), auto: 'Auto' })[pref];

class Theme extends Observable {
  pref: ThemePref = load<ThemePref>('theme', 'dark');
  mode: ThemeMode = 'dark';
  private started = false;

  constructor() {
    super(0);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => this.apply());
    new MutationObserver(() => this.apply()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    this.apply();
  }

  set(pref: ThemePref): void {
    this.pref = pref;
    save('theme', pref);
    this.apply();
  }

  /** Dark → light → auto → dark. */
  cycle(): void {
    this.set(this.pref === 'dark' ? 'light' : this.pref === 'light' ? 'auto' : 'dark');
  }

  private resolve(): ThemeMode {
    if (this.pref !== 'auto') return this.pref;
    const host = document.documentElement.getAttribute('data-theme');
    if (host === 'dark' || host === 'light') return host;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  private apply(): void {
    const mode = this.resolve();
    const root = document.documentElement;
    if (root.dataset.mode !== mode) root.dataset.mode = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'light' ? '#f7f5f0' : '#000000');
    this.mode = mode;
    // Always notify: the preference label changes even when the resolved mode does not.
    this.emit(true);
  }
}

export const theme = new Theme();

/** Chart colours for the current mode (lightweight-charts needs concrete values, not CSS variables). */
export function chartPalette(mode: ThemeMode = theme.mode) {
  return mode === 'light'
    ? {
        bg: '#ffffff',
        text: '#625d52',
        grid: '#efece4',
        border: '#e0dcd2',
        amber: '#a85f00',
        long: '#0d8a3c',
        short: '#cc2424',
        liq: '#b8860b',
        crosshair: '#d9b980',
        areaTop: 'rgba(168,95,0,0.22)',
        areaBottom: 'rgba(168,95,0,0.02)',
        longFill: 'rgba(13,138,60,0.22)',
        shortFill: 'rgba(204,36,36,0.22)',
      }
    : {
        bg: '#000000',
        text: '#8c8c8c',
        grid: '#141414',
        border: '#262626',
        amber: '#f8a01f',
        long: '#23d160',
        short: '#ff4242',
        liq: '#ffd23f',
        crosshair: '#5c4012',
        areaTop: 'rgba(248,160,31,0.28)',
        areaBottom: 'rgba(248,160,31,0.02)',
        longFill: 'rgba(35,209,96,0.28)',
        shortFill: 'rgba(255,66,66,0.28)',
      };
}

/** Colours for horizontal price levels (entries, liquidations) and their legends. */
export const levelColors = (mode: ThemeMode = theme.mode) => {
  const p = chartPalette(mode);
  return { long: p.long, short: p.short, liq: p.liq };
};
