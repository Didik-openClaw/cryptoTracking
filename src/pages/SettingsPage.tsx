import { useEffect, useState, type ReactNode } from 'react';
import { ConfirmButton, UsdSelect } from '../components/ui';
import { apiStats, limiter } from '../lib/api';
import { fmtAgo, fmtUsd } from '../lib/format';
import { live } from '../lib/live';
import { news, newsSourceLabel } from '../lib/news';
import { useObservable } from '../lib/observable';
import { scanner } from '../lib/scanner';
import { settings, type Settings } from '../lib/settings';
import { remove } from '../lib/storage';
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
            <span className="fn">PREF</span>Pengaturan
          </h1>
          <p>Semua pengaturan disimpan di browser ini.</p>
        </div>
        <ConfirmButton label="Reset ke default" question="Kembalikan semua pengaturan ke default?" onConfirm={() => settings.reset()} />
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Scanner whale</h2>
        </div>
        <Row title="Posisi minimal yang dianggap jumbo" hint="Dipakai di Scanner, Long vs Short, dan halaman coin.">
          <UsdSelect value={s.minPositionUsd} onChange={(v) => settings.update({ minPositionUsd: v })} />
        </Row>
        <Row
          title="Jumlah akun yang dipindai"
          hint={`Akun leaderboard dengan nilai akun terbesar dipindai lebih dulu. Satu putaran ±${estMinutes.toFixed(1)} menit dengan kecepatan sekarang.`}
        >
          <select className="input" value={s.scanLimit} onChange={(e) => settings.update({ scanLimit: Number(e.target.value) })}>
            {[300, 500, 1000, 1500, 2000, 3000, 5000, 8000].map((v) => (
              <option key={v} value={v}>
                {v.toLocaleString('id-ID')} akun
              </option>
            ))}
          </select>
        </Row>
        <Row title="Nilai akun minimal" hint="Akun lebih kecil dari ini dilewati (posisi $5M butuh margin ±$125K di leverage 40x).">
          <UsdSelect
            value={s.minAccountValue}
            onChange={(v) => settings.update({ minAccountValue: v })}
            presets={[10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000]}
          />
        </Row>
        <Row
          title="Kecepatan request (bobot/menit)"
          hint="Batas Hyperliquid 1200 per menit per IP, dipakai bersama tab Hyperliquid lain di jaringanmu. Turunkan jika sering kena rate limit."
        >
          <NumberInput k="rateBudget" min={100} max={1150} step={50} />
        </Row>
        <Row title="Refresh wallet whale setiap (detik)" hint="Wallet yang sudah diketahui punya posisi jumbo dicek ulang lebih sering.">
          <NumberInput k="hotRefreshSec" min={15} max={600} />
        </Row>
        <Row title="Scan terus-menerus" hint="Setelah satu putaran selesai, mulai lagi dari akun terbesar.">
          <label className="check">
            <input type="checkbox" checked={s.continuousScan} onChange={(e) => settings.update({ continuousScan: e.target.checked })} />
            Aktif
          </label>
        </Row>
        <Row title="Batas alert 'whale baru'" hint="Ukuran posisi minimal untuk alert whale baru dari scanner (aktifkan di Watchlist).">
          <UsdSelect value={s.alertNewWhaleMinUsd} onChange={(v) => settings.update({ alertNewWhaleMinUsd: v })} />
        </Row>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Live trade &amp; watchlist</h2>
        </div>
        <Row title="Trade minimal di live feed">
          <UsdSelect value={s.liveMinUsd} onChange={(v) => settings.update({ liveMinUsd: v })} />
        </Row>
        <Row title="Jumlah coin yang dipantau di live feed" hint="Coin dengan volume 24 jam terbesar.">
          <NumberInput k="liveTopCoins" min={5} max={250} step={5} />
        </Row>
        <Row title="Cek wallet watchlist setiap (detik)" hint="Untuk wallet di luar 10 teratas yang tidak real-time.">
          <NumberInput k="watchPollSec" min={5} max={600} />
        </Row>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Berita</h2>
        </div>
        <Row
          title="API key CoinDesk Data (opsional)"
          hint={
            <>
              Tanpa key, berita tetap dimuat dengan batas request gratis. Key gratis dari{' '}
              <a href="https://developers.coindesk.com/" target="_blank" rel="noreferrer">
                developers.coindesk.com
              </a>{' '}
              menaikkan batasnya. Disimpan hanya di browser ini.
            </>
          }
        >
          <input
            id="news-api-key"
            className="input"
            type="password"
            autoComplete="off"
            style={{ width: 260 }}
            placeholder="kosongkan jika tidak ada"
            value={s.newsApiKey}
            onChange={(e) => settings.update({ newsApiKey: e.target.value })}
            onBlur={() => void news.refresh()}
          />
        </Row>
        <Row title="Sumber aktif" hint={news.error ? `Gagal: ${news.error}` : 'Diperbarui otomatis setiap 2 menit.'}>
          <span className="muted">
            {news.status === 'unavailable'
              ? 'tidak aktif (mode demo)'
              : `${newsSourceLabel(news.source)} · ${news.items.length} headline${news.updatedAt ? ` · ${fmtAgo(news.updatedAt)}` : ''}`}
          </span>
        </Row>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Status koneksi</h2>
        </div>
        <dl className="kv" style={{ maxWidth: 560 }}>
          <dt>Websocket</dt>
          <dd>
            {socket.status} · {socket.subscriptionCount()} subscription · {socket.messages.toLocaleString('id-ID')} pesan
          </dd>
          <dt>Live feed</dt>
          <dd>{live.coins.length} coin dipantau</dd>
          <dt>Request REST</dt>
          <dd>
            {apiStats.requests.toLocaleString('id-ID')} total · antrean {limiter.pending}
          </dd>
          <dt>Error / rate limit</dt>
          <dd>
            {apiStats.errors} / {apiStats.rateLimited}
            {apiStats.lastErrorAt > 0 && <div className="small muted">{apiStats.lastError} ({fmtAgo(apiStats.lastErrorAt)})</div>}
          </dd>
          <dt>Scanner</dt>
          <dd>
            {scanner.scannedTotal.toLocaleString('id-ID')} akun dipindai sesi ini · {scanner.wallets.size} wallet dengan posisi ≥{' '}
            {fmtUsd(100_000)}
          </dd>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Data tersimpan</h2>
        </div>
        <Row title="Hapus cache scan & daftar akun" hint="Watchlist dan pengaturan tidak ikut terhapus.">
          <ConfirmButton
            danger
            label="Hapus cache"
            question="Hapus cache hasil scan dan leaderboard?"
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
