import { useEffect, useState, type ReactNode } from 'react';
import { ConfirmButton, Seg, UsdSelect } from '../components/ui';
import { apiStats, limiter } from '../lib/api';
import { fmtAgo, fmtCount, fmtUsd } from '../lib/format';
import { language, tr, useLang, type Lang } from '../lib/i18n';
import { live } from '../lib/live';
import { news, newsSourceLabel } from '../lib/news';
import { useObservable } from '../lib/observable';
import { scanner } from '../lib/scanner';
import { settings, type Settings } from '../lib/settings';
import { remove } from '../lib/storage';
import { themeLabel, theme, type ThemePref } from '../lib/theme';
import { socket } from '../lib/ws';

function Row({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="row" style={{ justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ maxWidth: 620 }}>
        <div>{title}</div>
        {hint && <div className="small muted">{hint}</div>}
      </div>
      <div className="row">{children}</div>
    </div>
  );
}

function NumberInput({ k, min, max, step = 1, width = 100 }: { k: keyof Settings; min: number; max: number; step?: number; width?: number }) {
  const v = settings.value[k] as number;
  return (
    <input
      className="input"
      type="number"
      min={min}
      max={max}
      step={step}
      style={{ width }}
      value={v}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (Number.isFinite(n)) settings.update({ [k]: Math.min(max, Math.max(min, n)) } as Partial<Settings>);
      }}
    />
  );
}

export function SettingsPage() {
  useObservable(settings);
  useObservable(scanner);
  useObservable(socket);
  useObservable(news);
  useObservable(theme);
  useLang();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 2000);
    return () => clearInterval(t);
  }, []);
  const s = settings.value;
  const estMinutes = (s.scanLimit * 2) / Math.max(1, s.rateBudget * 0.8);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            <span className="fn">PREF</span>
            {tr('Pengaturan', 'Settings')}
          </h1>
          <p>{tr('Semua pengaturan disimpan di browser ini.', 'All settings are stored in this browser.')}</p>
        </div>
        <ConfirmButton
          label={tr('Reset ke default', 'Reset to defaults')}
          question={tr('Kembalikan semua pengaturan ke default?', 'Restore all settings to defaults?')}
          onConfirm={() => settings.reset()}
        />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Tampilan', 'Display')}</h2>
        </div>
        <Row
          title={tr('Tema', 'Theme')}
          hint={tr(
            'Auto mengikuti pengaturan gelap/terang perangkat. Bisa juga diganti dari tombol di header.',
            "Auto follows the device's dark/light setting. Can also be changed from the button in the header.",
          )}
        >
          <Seg<ThemePref>
            value={theme.pref}
            onChange={(v) => theme.set(v)}
            options={(['dark', 'light', 'auto'] as ThemePref[]).map((v) => ({ value: v, label: themeLabel(v) }))}
          />
        </Row>
        <Row
          title="Bahasa / Language"
          hint={tr(
            'Bahasa tampilan. Bisa juga diganti dari tombol di header.',
            'Interface language. Can also be changed from the button in the header.',
          )}
        >
          <Seg<Lang>
            value={language.lang}
            onChange={(v) => language.set(v)}
            options={[
              { value: 'id', label: 'Indonesia' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Row>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Scanner whale', 'Whale scanner')}</h2>
        </div>
        <Row
          title={tr('Posisi minimal yang dianggap jumbo', 'Min. position size to count as whale')}
          hint={tr('Dipakai di Scanner, Long vs Short, dan halaman coin.', 'Used in Scanner, Long vs Short and coin pages.')}
        >
          <UsdSelect value={s.minPositionUsd} onChange={(v) => settings.update({ minPositionUsd: v })} />
        </Row>
        <Row
          title={tr('Jumlah akun yang dipindai', 'Accounts to scan')}
          hint={tr(
            <>
              Akun leaderboard dengan nilai akun terbesar dipindai lebih dulu. Satu putaran ±{estMinutes.toFixed(1)} menit dengan
              kecepatan sekarang.
            </>,
            <>
              Leaderboard accounts with the largest account value are scanned first. One pass takes ±{estMinutes.toFixed(1)} min at
              the current rate.
            </>,
          )}
        >
          <select className="input" value={s.scanLimit} onChange={(e) => settings.update({ scanLimit: Number(e.target.value) })}>
            {[300, 500, 1000, 1500, 2000, 3000, 5000, 8000].map((v) => (
              <option key={v} value={v}>
                {fmtCount(v)} {tr('akun', 'accounts')}
              </option>
            ))}
          </select>
        </Row>
        <Row
          title={tr('Nilai akun minimal', 'Min. account value')}
          hint={tr(
            'Akun lebih kecil dari ini dilewati (posisi $5M butuh margin ±$125K di leverage 40x).',
            'Smaller accounts are skipped (a $5M position needs ±$125K margin at 40x leverage).',
          )}
        >
          <UsdSelect
            value={s.minAccountValue}
            onChange={(v) => settings.update({ minAccountValue: v })}
            presets={[10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000]}
          />
        </Row>
        <Row
          title={tr('Kecepatan request (bobot/menit)', 'Request rate (weight/min)')}
          hint={tr(
            <>
              Batas Hyperliquid 1200 per menit per IP, dipakai bersama tab Hyperliquid lain di jaringanmu. Turunkan jika sering kena
              rate limit.
            </>,
            <>
              Hyperliquid allows 1200 per minute per IP, shared with other Hyperliquid tabs on your network. Lower it if you often
              hit the rate limit.
            </>,
          )}
        >
          <NumberInput k="rateBudget" min={100} max={1150} step={50} />
        </Row>
        <Row
          title={tr('Refresh wallet whale setiap (detik)', 'Refresh whale wallets every (sec)')}
          hint={tr(
            'Wallet yang sudah diketahui punya posisi jumbo dicek ulang lebih sering.',
            'Wallets already known to hold whale positions are rechecked more often.',
          )}
        >
          <NumberInput k="hotRefreshSec" min={15} max={600} />
        </Row>
        <Row
          title={tr('Scan terus-menerus', 'Continuous scan')}
          hint={tr(
            'Setelah satu putaran selesai, mulai lagi dari akun terbesar.',
            'After a pass finishes, start over from the largest account.',
          )}
        >
          <label className="check">
            <input type="checkbox" checked={s.continuousScan} onChange={(e) => settings.update({ continuousScan: e.target.checked })} />
            {tr('Aktif', 'On')}
          </label>
        </Row>
        <Row
          title={tr("Batas alert 'whale baru'", "'New whale' alert threshold")}
          hint={tr(
            'Ukuran posisi minimal untuk alert whale baru dari scanner (aktifkan di Watchlist).',
            'Min. position size for new-whale alerts from the scanner (enable in Watchlist).',
          )}
        >
          <UsdSelect value={s.alertNewWhaleMinUsd} onChange={(v) => settings.update({ alertNewWhaleMinUsd: v })} />
        </Row>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Live trade & watchlist', 'Live trades & watchlist')}</h2>
        </div>
        <Row title={tr('Trade minimal di live feed', 'Min. trade in live feed')}>
          <UsdSelect value={s.liveMinUsd} onChange={(v) => settings.update({ liveMinUsd: v })} />
        </Row>
        <Row
          title={tr('Jumlah coin yang dipantau di live feed', 'Coins tracked in live feed')}
          hint={tr('Coin dengan volume 24 jam terbesar.', 'Coins with the highest 24h volume.')}
        >
          <NumberInput k="liveTopCoins" min={5} max={250} step={5} />
        </Row>
        <Row
          title={tr('Cek wallet watchlist setiap (detik)', 'Check watchlist wallets every (sec)')}
          hint={tr(
            'Untuk wallet di luar 10 teratas yang tidak real-time.',
            'For wallets outside the top 10, which are not real-time.',
          )}
        >
          <NumberInput k="watchPollSec" min={5} max={600} />
        </Row>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Berita', 'News')}</h2>
        </div>
        <Row
          title={tr('API key CoinDesk Data (opsional)', 'CoinDesk Data API key (optional)')}
          hint={tr(
            <>
              Tanpa key, berita tetap dimuat dengan batas request gratis. Key gratis dari{' '}
              <a href="https://developers.coindesk.com/" target="_blank" rel="noreferrer">
                developers.coindesk.com
              </a>{' '}
              menaikkan batasnya. Disimpan hanya di browser ini.
            </>,
            <>
              Without a key, news still loads within the free request limit. A free key from{' '}
              <a href="https://developers.coindesk.com/" target="_blank" rel="noreferrer">
                developers.coindesk.com
              </a>{' '}
              raises the limit. Stored only in this browser.
            </>,
          )}
        >
          <input
            id="news-api-key"
            className="input"
            type="password"
            autoComplete="off"
            style={{ width: 260 }}
            placeholder={tr('kosongkan jika tidak ada', 'leave empty if none')}
            value={s.newsApiKey}
            onChange={(e) => settings.update({ newsApiKey: e.target.value })}
            onBlur={() => void news.refresh()}
          />
        </Row>
        <Row
          title={tr('Sumber aktif', 'Active source')}
          hint={
            news.error
              ? tr(`Gagal: ${news.error}`, `Failed: ${news.error}`)
              : tr('Diperbarui otomatis setiap 2 menit.', 'Auto-refreshed every 2 minutes.')
          }
        >
          <span className="muted">
            {news.status === 'unavailable'
              ? tr('tidak aktif (mode demo)', 'inactive (demo mode)')
              : `${newsSourceLabel(news.source)} · ${news.items.length} ${tr('headline', 'headlines')}` +
                (news.updatedAt ? ` · ${fmtAgo(news.updatedAt)}` : '')}
          </span>
        </Row>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Status koneksi', 'Connection status')}</h2>
        </div>
        <dl className="kv" style={{ maxWidth: 560 }}>
          <dt>Websocket</dt>
          <dd>
            {socket.status} · {socket.subscriptionCount()} {tr('subscription', 'subscriptions')} · {fmtCount(socket.messages)}{' '}
            {tr('pesan', 'messages')}
          </dd>
          <dt>Live feed</dt>
          <dd>
            {live.coins.length} {tr('coin dipantau', 'coins tracked')}
          </dd>
          <dt>{tr('Request REST', 'REST requests')}</dt>
          <dd>
            {fmtCount(apiStats.requests)} total · {tr('antrean', 'queue')} {limiter.pending}
          </dd>
          <dt>{tr('Error / rate limit', 'Errors / rate limit')}</dt>
          <dd>
            {apiStats.errors} / {apiStats.rateLimited}
            {apiStats.lastErrorAt > 0 && <div className="small muted">{apiStats.lastError} ({fmtAgo(apiStats.lastErrorAt)})</div>}
          </dd>
          <dt>Scanner</dt>
          <dd>
            {tr(
              <>
                {fmtCount(scanner.scannedTotal)} akun dipindai sesi ini · {scanner.wallets.size} wallet dengan posisi ≥{' '}
                {fmtUsd(100_000)}
              </>,
              <>
                {fmtCount(scanner.scannedTotal)} accounts scanned this session · {scanner.wallets.size} wallets with positions ≥{' '}
                {fmtUsd(100_000)}
              </>,
            )}
          </dd>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{tr('Data tersimpan', 'Stored data')}</h2>
        </div>
        <Row
          title={tr('Hapus cache scan & daftar akun', 'Clear scan cache & account list')}
          hint={tr('Watchlist dan pengaturan tidak ikut terhapus.', 'Watchlist and settings are kept.')}
        >
          <ConfirmButton
            danger
            label={tr('Hapus cache', 'Clear cache')}
            question={tr('Hapus cache hasil scan dan leaderboard?', 'Clear cached scan results and leaderboard?')}
            onConfirm={() => {
              for (const k of ['scan', 'seeds', 'seeds2', 'discovered', 'opentimes', 'tstats']) remove(k);
              location.reload();
            }}
          />
        </Row>
      </section>
    </div>
  );
}
