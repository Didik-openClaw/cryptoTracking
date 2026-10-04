import { language, tr, useLang } from '../lib/i18n';

/** ID | EN switch for the header; the active language is highlighted. */
export function LangButton() {
  const lang = useLang();
  return (
    <button
      type="button"
      className="theme-btn lang-btn"
      onClick={() => language.toggle()}
      title={tr('Switch to English', 'Ganti ke Bahasa Indonesia')}
      aria-label={tr('Bahasa: Indonesia. Klik untuk English.', 'Language: English. Click for Bahasa Indonesia.')}
    >
      <span className={lang === 'id' ? 'on' : ''}>ID</span>
      <span className={lang === 'en' ? 'on' : ''}>EN</span>
    </button>
  );
}
