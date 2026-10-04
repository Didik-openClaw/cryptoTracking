import { useEffect, useMemo, useState } from 'react';
import { Seg, Spinner } from '../components/ui';
import { api, fmtCountdown, fmtDate, fmtRupiah, remaining, useNow, waLink, type Me, type PublicConfig } from '../lib/accessClient';
import { useObservable } from '../lib/observable';
import { THEME_LABEL, theme } from '../lib/theme';

const REASON_TEXT: Record<string, string> = {
  expired: 'Masa akses Anda sudah habis. Perpanjang untuk membuka terminal lagi.',
  revoked: 'Kode akses Anda dinonaktifkan. Hubungi admin lewat WhatsApp.',
  device: 'Perangkat ini dikeluarkan dari kode akses Anda. Masukkan kode lagi untuk mendaftarkannya.',
  invalid: 'Sesi tidak dikenali. Masukkan kode akses Anda.',
  session: 'Sesi berakhir. Masukkan kode akses Anda lagi.',
};

const FEATURES: [string, string, string][] = [
  ['WHAL', 'Scanner whale', 'Semua posisi perp Hyperliquid ≥ $5 juta: siapa long, siapa short, entry, harga likuidasi, waktu buka.'],
  ['LSHT', 'Long vs Short per coin', 'Total posisi whale tiap coin, porsi dari open interest, dan peta likuidasi.'],
  ['TOPW', 'Top 20 whale profit', 'Win rate, profit factor, expectancy, dan bias long/short trader paling cuan.'],
  ['BLKT', 'Trade besar live', 'Market order jutaan dollar real-time, lengkap dengan posisi trader saat ini.'],
  ['WTCH', 'Watchlist & alert', 'Notifikasi saat whale favorit buka, tutup, tambah posisi, atau mendekati likuidasi.'],
  ['NEWS', 'Berita & wire', 'Headline kripto terbaru dan kabar pasar dari data Hyperliquid di samping chart.'],
];

export function BuyPage() {
  useObservable(theme);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const reason = new URLSearchParams(location.search).get('alasan') ?? '';

  useEffect(() => {
    api<PublicConfig>('/api/config').then(setConfig, (e: Error) => setConfigError(e.message));
    api<Me>('/api/me').then(setMe, () => setMe(null));
  }, []);

  const offset = config ? config.serverTime - Date.now() : 0;

  return (
    <>
      <header className="term-head">
        <div className="cmdbar">
          <a className="brand" href="/">
            <span className="logo">DTY</span>Crypto Terminal
          </a>
          <span className="grow" />
          <button type="button" className="theme-btn" onClick={() => theme.cycle()} title="Ganti tema">
            <span className="theme-icon" aria-hidden="true" />
            {THEME_LABEL[theme.pref]}
          </button>
        </div>
      </header>
      <main className="buy">
        <div className="page-head">
          <div>
            <h1>
              <span className="fn">BELI</span>Akses DTY Crypto Terminal
            </h1>
            <p>Lacak trader Hyperliquid dengan posisi jutaan dollar secara real-time: siapa long, siapa short, kapan masuk, dan di mana likuidasinya.</p>
          </div>
        </div>
        {reason && REASON_TEXT[reason] && <div className="notice" style={{ marginBottom: 10 }}>{REASON_TEXT[reason]}</div>}
        {configError && <div className="notice error" style={{ marginBottom: 10 }}>{configError}</div>}

        <div className="grid-main">
          <div className="stack">
            {config ? <PricePanel config={config} offset={offset} /> : !configError && <section className="panel"><div className="empty"><Spinner /> Memuat harga…</div></section>}
            {config && <HowToPay config={config} />}
            <section className="panel">
              <div className="panel-head">
                <h2>Yang Anda dapat</h2>
              </div>
              <ul className="feature-list">
                {FEATURES.map(([code, title, body]) => (
                  <li key={code}>
                    <span className="fn">{code}</span>
                    <div>
                      <b>{title}</b>
                      <div className="muted small">{body}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <div className="stack">
            {me === undefined ? (
              <section className="panel">
                <div className="empty">
                  <Spinner />
                </div>
              </section>
            ) : me ? (
              <AccountPanel me={me} config={config} offset={offset} onLogout={() => setMe(null)} />
            ) : (
              <ActivatePanel />
            )}
            <section className="panel">
              <div className="panel-head">
                <h2>Coba dulu, gratis</h2>
              </div>
              <p className="small muted" style={{ marginTop: 0 }}>
                Jelajahi semua fitur dengan data pasar simulasi sebelum membeli.
              </p>
              <a className="btn" href="/demo/">
                Buka demo
              </a>
            </section>
          </div>
        </div>
      </main>
      <footer className="statusbar">
        <span>
          <b>DTY</b>Crypto Terminal
        </span>
        <span className="sp dim">Data publik Hyperliquid · bukan saran finansial</span>
      </footer>
    </>
  );
}

function PromoCountdown({ end, now }: { end: number; now: number }) {
  const r = remaining(end - now);
  if (r.done) return null;
  const cells: [number, string][] = [
    [r.days, 'hari'],
    [r.hours, 'jam'],
    [r.minutes, 'menit'],
    [r.seconds, 'detik'],
  ];
  return (
    <div className="promo">
      <div className="promo-label">Harga promo berakhir dalam</div>
      <div className="promo-cells" role="timer" aria-live="off">
        {cells.map(([v, label]) => (
          <div key={label} className="promo-cell">
            <b>{String(v).padStart(2, '0')}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="dim small">Sampai {fmtDate(end)}</div>
    </div>
  );
}

function PricePanel({ config, offset }: { config: PublicConfig; offset: number }) {
  const now = useNow(1000, offset);
  const [months, setMonths] = useState(config.packages[0] ?? 1);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [placed, setPlaced] = useState<{ id: string; url: string } | null>(null);
  const promoActive = config.promoEnd > now;
  const showNormal = config.normalPrice > config.price && promoActive;
  const total = config.price * months;

  const order = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!config.whatsapp) return setError('Nomor WhatsApp admin belum diatur. Silakan coba lagi nanti.');
    setBusy(true);
    // Open the tab inside the click so popup blockers allow it; point it at WhatsApp once the order is saved.
    const win = window.open('about:blank', '_blank');
    try {
      const res = await api<{ id: string; total: number }>('/api/order', { method: 'POST', body: JSON.stringify({ name, contact, months }) });
      const message = [
        'Halo admin DTY Crypto Terminal, saya mau beli akses.',
        '',
        `No. pesanan: #${res.id}`,
        `Nama: ${name.trim()}`,
        `Paket: ${months} bulan`,
        `Total: ${fmtRupiah(res.total)}`,
        '',
        'Saya akan kirim bukti pembayaran di chat ini.',
      ].join('\n');
      const url = waLink(config.whatsapp, message);
      setPlaced({ id: res.id, url });
      if (win) {
        win.opener = null;
        win.location.href = url;
      }
    } catch (err) {
      win?.close();
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Harga akses</h2>
        <span className="hint">1 bulan = 30 hari</span>
      </div>
      <div className="price-row">
        {showNormal && <s className="dim">{fmtRupiah(config.normalPrice)}</s>}
        <span className="price">{fmtRupiah(config.price)}</span>
        <span className="muted">/ bulan</span>
        {showNormal && <span className="tag accent">hemat {fmtRupiah(config.normalPrice - config.price)}</span>}
      </div>
      {config.promoEnd > 0 && <PromoCountdown end={config.promoEnd} now={now} />}

      <form className="stack" style={{ gap: 10, marginTop: 12 }} onSubmit={order}>
        <div className="field">
          <span>Paket</span>
          <Seg<number> value={months} onChange={setMonths} options={config.packages.map((m) => ({ value: m, label: `${m} bulan` }))} />
        </div>
        <div className="total-row">
          <span className="muted">Total</span>
          <b className="price-total">{fmtRupiah(total)}</b>
          <span className="dim small">akses {months * 30} hari</span>
        </div>
        <div className="row">
          <label className="field grow" style={{ minWidth: 180 }}>
            <span>Nama</span>
            <input id="buy-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama Anda" autoComplete="name" required minLength={2} maxLength={60} />
          </label>
          <label className="field grow" style={{ minWidth: 180 }}>
            <span>No. WhatsApp</span>
            <input id="buy-contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="08…" inputMode="tel" autoComplete="tel" required />
          </label>
        </div>
        {error && <div className="small danger">{error}</div>}
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Mencatat pesanan…' : 'Pesan via WhatsApp'}
          </button>
          <span className="dim small">Pesanan tercatat, lalu WhatsApp admin terbuka dengan pesan otomatis.</span>
        </div>
      </form>
      {placed && (
        <div className="notice info" style={{ marginTop: 10 }}>
          Pesanan <b>#{placed.id}</b> tercatat. Lanjutkan di WhatsApp dan kirim bukti pembayaran. Kalau WhatsApp tidak terbuka,{' '}
          <a href={placed.url} target="_blank" rel="noreferrer">
            klik di sini
          </a>
          .
        </div>
      )}
    </section>
  );
}

function HowToPay({ config }: { config: PublicConfig }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Cara beli</h2>
      </div>
      <ol className="steps">
        <li>
          <b>Pesan</b> lewat form di atas. WhatsApp admin terbuka dengan nomor pesanan Anda.
        </li>
        <li>
          <b>Bayar</b> sesuai total ke:
          {config.paymentInfo ? (
            <pre className="pay-info">{config.paymentInfo}</pre>
          ) : (
            <div className="muted small">Info rekening / QRIS dikirim admin lewat WhatsApp.</div>
          )}
        </li>
        <li>
          <b>Kirim bukti bayar</b> di chat WhatsApp tersebut.
        </li>
        <li>
          <b>Terima kode akses</b> dari admin, lalu masukkan di kolom <i>Aktifkan kode akses</i>. Terminal langsung terbuka. Satu kode bisa
          dipakai di {config.maxDevices} perangkat.
        </li>
      </ol>
    </section>
  );
}

function ActivatePanel() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ name: string; exp: number } | null>(null);

  const activate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ name: string; exp: number }>('/api/login', { method: 'POST', body: JSON.stringify({ code }) });
      setDone(res);
      setTimeout(() => location.assign('/'), 1200);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Aktifkan kode akses</h2>
      </div>
      {done ? (
        <div className="notice info">
          Selamat datang, <b>{done.name}</b>. Akses aktif sampai {fmtDate(done.exp)}. Membuka terminal…
        </div>
      ) : (
        <form className="stack" style={{ gap: 8 }} onSubmit={activate}>
          <input
            id="access-code"
            className="input code-input"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="DTY-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            required
          />
          {error && <div className="small danger">{error}</div>}
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? 'Memeriksa…' : 'Aktifkan'}
          </button>
        </form>
      )}
    </section>
  );
}

function AccountPanel({ me, config, offset, onLogout }: { me: Me; config: PublicConfig | null; offset: number; onLogout: () => void }) {
  const now = useNow(1000, offset);
  const left = me.exp - now;
  const [busy, setBusy] = useState(false);
  const tone = left < 86_400_000 ? 'danger' : left < 3 * 86_400_000 ? 'warn' : 'pos';
  const renew = useMemo(
    () =>
      config?.whatsapp
        ? waLink(
            config.whatsapp,
            ['Halo admin DTY Crypto Terminal, saya mau perpanjang akses.', '', `Nama: ${me.name}`, `Kode: ${me.code}`, 'Perpanjang: 1 bulan'].join('\n'),
          )
        : '',
    [config?.whatsapp, me.name, me.code],
  );

  const logout = async () => {
    setBusy(true);
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    onLogout();
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Status akses</h2>
        <span className="tag accent">aktif</span>
      </div>
      <div className="small muted">Halo, {me.name}</div>
      <div className={`account-left ${tone}`}>{fmtCountdown(left)}</div>
      <dl className="kv">
        <dt>Berakhir</dt>
        <dd>{fmtDate(me.exp)}</dd>
        <dt>Kode</dt>
        <dd className="mono">{me.code}</dd>
        <dt>Perangkat</dt>
        <dd>
          {me.devicesUsed} / {me.maxDevices}
        </dd>
      </dl>
      <div className="stack" style={{ gap: 6, marginTop: 12 }}>
        <a className="btn primary" href="/">
          Buka terminal
        </a>
        {renew && (
          <a className="btn" href={renew} target="_blank" rel="noreferrer">
            Perpanjang via WhatsApp
          </a>
        )}
        <button type="button" className="btn ghost" onClick={() => void logout()} disabled={busy}>
          Keluar dari perangkat ini
        </button>
      </div>
    </section>
  );
}
