import { useEffect, useMemo, useState } from 'react';
import { LangButton } from '../components/LangButton';
import { Seg, Spinner } from '../components/ui';
import { api, fmtCountdown, fmtDate, fmtRupiah, remaining, useNow, waLink, type Me, type PublicConfig } from '../lib/accessClient';
import { tr } from '../lib/i18n';
import { useObservable } from '../lib/observable';
import { themeLabel, theme } from '../lib/theme';

const reasonText = (): Record<string, string> => ({
  expired: tr(
    'Masa akses Anda sudah habis. Perpanjang untuk membuka terminal lagi.',
    'Your access has expired. Renew to open the terminal again.',
  ),
  revoked: tr(
    'Kode akses Anda dinonaktifkan. Hubungi admin lewat WhatsApp.',
    'Your access code has been deactivated. Contact the admin on WhatsApp.',
  ),
  device: tr(
    'Perangkat ini dikeluarkan dari kode akses Anda. Masukkan kode lagi untuk mendaftarkannya.',
    'This device was removed from your access code. Enter the code again to register it.',
  ),
  invalid: tr('Sesi tidak dikenali. Masukkan kode akses Anda.', 'Session not recognized. Please enter your access code.'),
  session: tr('Sesi berakhir. Masukkan kode akses Anda lagi.', 'Your session has ended. Please enter your access code again.'),
});

const features = (): [string, string, string][] => [
  [
    'WHAL',
    tr('Scanner whale', 'Whale scanner'),
    tr(
      'Semua posisi perp Hyperliquid ≥ $5 juta: siapa long, siapa short, entry, harga likuidasi, waktu buka.',
      'Every Hyperliquid perp position ≥ $5M: who is long, who is short, entry, liquidation price, time opened.',
    ),
  ],
  [
    'LSHT',
    'Long vs Short per coin',
    tr(
      'Total posisi whale tiap coin, porsi dari open interest, dan peta likuidasi.',
      'Total whale positions per coin, their share of open interest, and a liquidation map.',
    ),
  ],
  [
    'TOPW',
    tr('Top 20 whale profit', 'Top 20 most profitable whales'),
    tr(
      'Win rate, profit factor, expectancy, dan bias long/short trader paling cuan.',
      'Win rate, profit factor, expectancy and long/short bias of the most profitable traders.',
    ),
  ],
  [
    'CHRT',
    tr('Chart + 17 indikator', 'Charts + 17 indicators'),
    tr(
      'MA/EMA, Bollinger, VWAP, Supertrend, Ichimoku, RSI, MACD, Stoch RSI, ADX dan lainnya; periode & warna bisa diatur, level entry dan likuidasi whale langsung di chart.',
      'MA/EMA, Bollinger, VWAP, Supertrend, Ichimoku, RSI, MACD, Stoch RSI, ADX and more with adjustable settings, plus whale entry and liquidation levels on the chart.',
    ),
  ],
  [
    'BLKT',
    tr('Trade besar live', 'Live block trades'),
    tr(
      'Market order jutaan dollar real-time, lengkap dengan posisi trader saat ini.',
      "Million-dollar market orders in real time, with each trader's current position.",
    ),
  ],
  [
    'WTCH',
    tr('Watchlist & alert', 'Watchlist & alerts'),
    tr(
      'Notifikasi saat whale favorit buka, tutup, tambah posisi, atau mendekati likuidasi.',
      'Get notified when your favorite whales open, close or add to a position, or get close to liquidation.',
    ),
  ],
  [
    'NEWS',
    tr('Berita & wire', 'News & wire'),
    tr(
      'Headline kripto terbaru dan kabar pasar dari data Hyperliquid di samping chart.',
      'Latest crypto headlines and market news from Hyperliquid data, right beside the chart.',
    ),
  ],
];

/** "3 bulan" / "3 months". */
const monthsText = (m: number) => tr(`${m} bulan`, m === 1 ? '1 month' : `${m} months`);

export function BuyPage() {
  useObservable(theme);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState('');
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const reason = new URLSearchParams(location.search).get('alasan') ?? '';
  const reasonMsg = reasonText()[reason];

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
          <button type="button" className="theme-btn" onClick={() => theme.cycle()} title={tr('Ganti tema', 'Change theme')}>
            <span className="theme-icon" aria-hidden="true" />
            {themeLabel(theme.pref)}
          </button>
          <LangButton />
        </div>
      </header>
      <main className="buy">
        <div className="page-head">
          <div>
            <h1>
              <span className="fn">{tr('BELI', 'BUY')}</span>
              {tr('Akses DTY Crypto Terminal', 'Get DTY Crypto Terminal access')}
            </h1>
            <p>
              {tr(
                'Lacak trader Hyperliquid dengan posisi jutaan dollar secara real-time: siapa long, siapa short, kapan masuk, dan di mana likuidasinya.',
                'Track Hyperliquid traders with million-dollar positions in real time: who is long, who is short, when they got in and where they get liquidated.',
              )}
            </p>
          </div>
        </div>
        {reason && reasonMsg && <div className="notice" style={{ marginBottom: 10 }}>{reasonMsg}</div>}
        {configError && <div className="notice error" style={{ marginBottom: 10 }}>{configError}</div>}

        <div className="grid-main">
          <div className="stack">
            {config ? <PricePanel config={config} offset={offset} /> : !configError && <section className="panel"><div className="empty"><Spinner /> {tr('Memuat harga…', 'Loading price…')}</div></section>}
            {config && <HowToPay config={config} />}
            <section className="panel">
              <div className="panel-head">
                <h2>{tr('Yang Anda dapat', 'What you get')}</h2>
              </div>
              <ul className="feature-list">
                {features().map(([code, title, body]) => (
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
                <h2>{tr('Coba dulu, gratis', 'Try it first, free')}</h2>
              </div>
              <p className="small muted" style={{ marginTop: 0 }}>
                {tr(
                  'Jelajahi semua fitur dengan data pasar simulasi sebelum membeli.',
                  'Explore every feature with simulated market data before you buy.',
                )}
              </p>
              <a className="btn" href="/demo/">
                {tr('Buka demo', 'Open demo')}
              </a>
            </section>
          </div>
        </div>
      </main>
      <footer className="statusbar">
        <span>
          <b>DTY</b>Crypto Terminal
        </span>
        <span className="sp dim">
          {tr('Data publik Hyperliquid · bukan saran finansial', 'Public Hyperliquid data · not financial advice')}
        </span>
      </footer>
    </>
  );
}

function PromoCountdown({ end, now }: { end: number; now: number }) {
  const r = remaining(end - now);
  if (r.done) return null;
  const cells: [number, string][] = [
    [r.days, tr('hari', 'days')],
    [r.hours, tr('jam', 'hours')],
    [r.minutes, tr('menit', 'mins')],
    [r.seconds, tr('detik', 'secs')],
  ];
  return (
    <div className="promo">
      <div className="promo-label">{tr('Harga promo berakhir dalam', 'Promo price ends in')}</div>
      <div className="promo-cells" role="timer" aria-live="off">
        {cells.map(([v, label]) => (
          <div key={label} className="promo-cell">
            <b>{String(v).padStart(2, '0')}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="dim small">
        {tr('Sampai', 'Until')} {fmtDate(end)}
      </div>
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
    if (!config.whatsapp) {
      return setError(
        tr('Nomor WhatsApp admin belum diatur. Silakan coba lagi nanti.', "The admin's WhatsApp number is not set yet. Please try again later."),
      );
    }
    setBusy(true);
    // Open the tab inside the click so popup blockers allow it; point it at WhatsApp once the order is saved.
    const win = window.open('about:blank', '_blank');
    try {
      const res = await api<{ id: string; total: number }>('/api/order', { method: 'POST', body: JSON.stringify({ name, contact, months }) });
      const message = tr(
        [
          'Halo admin DTY Crypto Terminal, saya mau beli akses.',
          '',
          `No. pesanan: #${res.id}`,
          `Nama: ${name.trim()}`,
          `Paket: ${months} bulan`,
          `Total: ${fmtRupiah(res.total)}`,
          '',
          'Saya akan kirim bukti pembayaran di chat ini.',
        ],
        [
          'Hi DTY Crypto Terminal admin, I would like to buy access.',
          '',
          `Order no.: #${res.id}`,
          `Name: ${name.trim()}`,
          `Package: ${monthsText(months)}`,
          `Total: ${fmtRupiah(res.total)}`,
          '',
          "I'll send proof of payment in this chat.",
        ],
      ).join('\n');
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
        <h2>{tr('Harga akses', 'Access price')}</h2>
        <span className="hint">{tr('1 bulan = 30 hari', '1 month = 30 days')}</span>
      </div>
      <div className="price-row">
        {showNormal && <s className="dim">{fmtRupiah(config.normalPrice)}</s>}
        <span className="price">{fmtRupiah(config.price)}</span>
        <span className="muted">{tr('/ bulan', '/ month')}</span>
        {showNormal && (
          <span className="tag accent">
            {tr('hemat', 'save')} {fmtRupiah(config.normalPrice - config.price)}
          </span>
        )}
      </div>
      {config.promoEnd > 0 && <PromoCountdown end={config.promoEnd} now={now} />}

      <form className="stack" style={{ gap: 10, marginTop: 12 }} onSubmit={order}>
        <div className="field">
          <span>{tr('Paket', 'Package')}</span>
          <Seg<number> value={months} onChange={setMonths} options={config.packages.map((m) => ({ value: m, label: monthsText(m) }))} />
        </div>
        <div className="total-row">
          <span className="muted">Total</span>
          <b className="price-total">{fmtRupiah(total)}</b>
          <span className="dim small">{tr(`akses ${months * 30} hari`, `${months * 30} days of access`)}</span>
        </div>
        <div className="row">
          <label className="field grow" style={{ minWidth: 180 }}>
            <span>{tr('Nama', 'Name')}</span>
            <input
              id="buy-name"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tr('Nama Anda', 'Your name')}
              autoComplete="name"
              required
              minLength={2}
              maxLength={60}
            />
          </label>
          <label className="field grow" style={{ minWidth: 180 }}>
            <span>{tr('No. WhatsApp', 'WhatsApp number')}</span>
            <input id="buy-contact" className="input" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="08…" inputMode="tel" autoComplete="tel" required />
          </label>
        </div>
        {error && <div className="small danger">{error}</div>}
        <div className="row">
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? tr('Mencatat pesanan…', 'Placing order…') : tr('Pesan via WhatsApp', 'Order via WhatsApp')}
          </button>
          <span className="dim small">
            {tr(
              'Pesanan tercatat, lalu WhatsApp admin terbuka dengan pesan otomatis.',
              'Your order is saved, then a WhatsApp chat with the admin opens with a ready-made message.',
            )}
          </span>
        </div>
      </form>
      {placed && (
        <div className="notice info" style={{ marginTop: 10 }}>
          {tr(
            <>
              Pesanan <b>#{placed.id}</b> tercatat. Lanjutkan di WhatsApp dan kirim bukti pembayaran. Kalau WhatsApp tidak terbuka,
            </>,
            <>
              Order <b>#{placed.id}</b> saved. Continue in WhatsApp and send your proof of payment. If WhatsApp did not open,
            </>,
          )}{' '}
          <a href={placed.url} target="_blank" rel="noreferrer">
            {tr('klik di sini', 'click here')}
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
        <h2>{tr('Cara beli', 'How to buy')}</h2>
      </div>
      <ol className="steps">
        <li>
          {tr(
            <>
              <b>Pesan</b> lewat form di atas. WhatsApp admin terbuka dengan nomor pesanan Anda.
            </>,
            <>
              <b>Order</b> with the form above. A WhatsApp chat with the admin opens with your order number.
            </>,
          )}
        </li>
        <li>
          {tr(
            <>
              <b>Bayar</b> sesuai total ke:
            </>,
            <>
              <b>Pay</b> the total to:
            </>,
          )}
          {config.paymentInfo ? (
            <pre className="pay-info">{config.paymentInfo}</pre>
          ) : (
            <div className="muted small">
              {tr('Info rekening / QRIS dikirim admin lewat WhatsApp.', 'The admin sends bank account / QRIS details on WhatsApp.')}
            </div>
          )}
        </li>
        <li>
          {tr(
            <>
              <b>Kirim bukti bayar</b> di chat WhatsApp tersebut.
            </>,
            <>
              <b>Send proof of payment</b> in that WhatsApp chat.
            </>,
          )}
        </li>
        <li>
          {tr(
            <>
              <b>Terima kode akses</b> dari admin, lalu masukkan di kolom <i>Aktifkan kode akses</i>. Terminal langsung terbuka. Satu
              kode bisa dipakai di {config.maxDevices} perangkat.
            </>,
            <>
              <b>Get your access code</b> from the admin and enter it under <i>Activate access code</i>. The terminal opens right
              away. One code works on up to {config.maxDevices} devices.
            </>,
          )}
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
        <h2>{tr('Aktifkan kode akses', 'Activate access code')}</h2>
      </div>
      {done ? (
        <div className="notice info">
          {tr(
            <>
              Selamat datang, <b>{done.name}</b>. Akses aktif sampai {fmtDate(done.exp)}. Membuka terminal…
            </>,
            <>
              Welcome, <b>{done.name}</b>. Access active until {fmtDate(done.exp)}. Opening the terminal…
            </>,
          )}
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
            {busy ? tr('Memeriksa…', 'Checking…') : tr('Aktifkan', 'Activate')}
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
            tr(
              [
                'Halo admin DTY Crypto Terminal, saya mau perpanjang akses.',
                '',
                `Nama: ${me.name}`,
                `Kode: ${me.code}`,
                'Perpanjang: 1 bulan',
              ],
              ['Hi DTY Crypto Terminal admin, I would like to renew my access.', '', `Name: ${me.name}`, `Code: ${me.code}`, 'Renew: 1 month'],
            ).join('\n'),
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
        <h2>{tr('Status akses', 'Access status')}</h2>
        <span className="tag accent">{tr('aktif', 'active')}</span>
      </div>
      <div className="small muted">
        {tr('Halo', 'Hi')}, {me.name}
      </div>
      <div className={`account-left ${tone}`}>{fmtCountdown(left)}</div>
      <dl className="kv">
        <dt>{tr('Berakhir', 'Expires')}</dt>
        <dd>{fmtDate(me.exp)}</dd>
        <dt>{tr('Kode', 'Code')}</dt>
        <dd className="mono">{me.code}</dd>
        <dt>{tr('Perangkat', 'Devices')}</dt>
        <dd>
          {me.devicesUsed} / {me.maxDevices}
        </dd>
      </dl>
      <div className="stack" style={{ gap: 6, marginTop: 12 }}>
        <a className="btn primary" href="/">
          {tr('Buka terminal', 'Open terminal')}
        </a>
        {renew && (
          <a className="btn" href={renew} target="_blank" rel="noreferrer">
            {tr('Perpanjang via WhatsApp', 'Renew via WhatsApp')}
          </a>
        )}
        <button type="button" className="btn ghost" onClick={() => void logout()} disabled={busy}>
          {tr('Keluar dari perangkat ini', 'Log out of this device')}
        </button>
      </div>
    </section>
  );
}
