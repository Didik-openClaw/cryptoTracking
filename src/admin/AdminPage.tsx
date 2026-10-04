import { useCallback, useEffect, useMemo, useState } from 'react';
import { ConfirmButton, Empty, Seg, Spinner, StatCard } from '../components/ui';
import {
  api,
  fmtCountdown,
  fmtDate,
  fmtRupiah,
  useNow,
  waLink,
  type AccessCode,
  type CodeStatus,
  type Order,
  type PublicConfig,
} from '../lib/accessClient';
import { useObservable } from '../lib/observable';
import { THEME_LABEL, theme } from '../lib/theme';

type Config = Omit<PublicConfig, 'serverTime'>;

const TOKEN_KEY = 'dty.admin';
const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
};
const writeToken = (t: string) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the password just is not remembered */
  }
};

const DAY = 86_400_000;

/** Message the admin sends the buyer with their code. */
function codeMessage(c: AccessCode, maxDevices: number): string {
  return [
    `Halo ${c.name}, terima kasih sudah membeli akses DTY Crypto Terminal.`,
    '',
    `Kode akses: ${c.code}`,
    `Aktif sampai: ${fmtDate(c.exp)}`,
    '',
    'Cara aktivasi:',
    `1. Buka ${location.origin}/beli/`,
    '2. Masukkan kode di kolom "Aktifkan kode akses"',
    '3. Klik Aktifkan, terminal langsung terbuka.',
    '',
    `Satu kode bisa dipakai di ${maxDevices} perangkat. Jangan bagikan kode ini.`,
  ].join('\n');
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text).catch(() => {});
}

export function AdminPage() {
  useObservable(theme);
  const [token, setToken] = useState(readToken);
  return (
    <>
      <header className="term-head">
        <div className="cmdbar">
          <a className="brand" href="/beli/">
            <span className="logo">DTY</span>Admin
          </a>
          <span className="grow" />
          <button type="button" className="theme-btn" onClick={() => theme.cycle()} title="Ganti tema">
            <span className="theme-icon" aria-hidden="true" />
            {THEME_LABEL[theme.pref]}
          </button>
          {token && (
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => {
                writeToken('');
                setToken('');
              }}
            >
              Keluar
            </button>
          )}
        </div>
      </header>
      <main>
        {token ? (
          <Dashboard
            token={token}
            onUnauthorized={() => {
              writeToken('');
              setToken('');
            }}
          />
        ) : (
          <Login
            onLogin={(t) => {
              writeToken(t);
              setToken(t);
            }}
          />
        )}
      </main>
    </>
  );
}

function Login({ onLogin }: { onLogin: (token: string) => void }) {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/admin/config', { admin: pw });
      onLogin(pw);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" style={{ maxWidth: 420, margin: '40px auto' }}>
      <div className="panel-head">
        <h2>Masuk admin</h2>
      </div>
      <form className="stack" style={{ gap: 8 }} onSubmit={submit}>
        <label className="field">
          <span>Password admin</span>
          <input id="admin-password" className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div className="small danger">{error}</div>}
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
        <div className="dim small">Password diatur lewat environment variable ADMIN_PASSWORD di Netlify.</div>
      </form>
    </section>
  );
}

interface Draft {
  name: string;
  contact: string;
  months: number;
  note: string;
  orderId?: string;
}

function Dashboard({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [codes, setCodes] = useState<AccessCode[] | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>({ name: '', contact: '', months: 1, note: '' });
  const now = useNow(1000);

  const call = useCallback(
    async <T,>(path: string, init: RequestInit = {}): Promise<T | null> => {
      try {
        setError('');
        return await api<T>(path, { ...init, admin: token });
      } catch (e) {
        const err = e as Error & { status?: number };
        if (err.status === 401) onUnauthorized();
        else setError(err.message);
        return null;
      }
    },
    [token, onUnauthorized],
  );

  const reload = useCallback(async () => {
    const [c, o, cfg] = await Promise.all([
      call<AccessCode[]>('/api/admin/codes'),
      call<Order[]>('/api/admin/orders'),
      call<Config>('/api/admin/config'),
    ]);
    if (c) setCodes(c);
    if (o) setOrders(o);
    if (cfg) setConfig(cfg);
  }, [call]);

  useEffect(() => {
    void reload();
    const t = setInterval(() => void reload(), 60_000); // new orders show up without a refresh
    return () => clearInterval(t);
  }, [reload]);

  const stats = useMemo(() => {
    const live = (codes ?? []).filter((c) => !c.revoked && c.exp > now);
    return {
      active: live.length,
      soon: live.filter((c) => c.exp - now < 7 * DAY).length,
      revenue: live.length * (config?.price ?? 0),
      newOrders: (orders ?? []).filter((o) => o.status === 'baru').length,
    };
  }, [codes, orders, config, now]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            <span className="fn">ADMN</span>Penjualan Akses
          </h1>
          <p>Pesanan dari halaman beli masuk ke sini. Setelah pembayaran diterima, buat kode akses dan kirim ke pembeli lewat WhatsApp.</p>
        </div>
        <button type="button" className="btn sm" onClick={() => void reload()}>
          Muat ulang
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}

      <div className="cards">
        <StatCard label="Pelanggan aktif" value={codes ? stats.active : <Spinner />} sub="kode akses yang masih berlaku" />
        <StatCard label="Habis ≤ 7 hari" tone={stats.soon ? 'danger' : undefined} value={stats.soon} sub="ingatkan untuk perpanjang" />
        <StatCard label="Nilai langganan aktif / bulan" value={fmtRupiah(stats.revenue)} sub={`${stats.active} × ${fmtRupiah(config?.price ?? 0)}`} />
        <StatCard label="Pesanan baru" tone={stats.newOrders ? 'long' : undefined} value={stats.newOrders} sub="menunggu pembayaran / kode" />
      </div>

      <div className="grid-main">
        <div className="stack">
          <OrdersPanel
            orders={orders}
            onMake={(o) => setDraft({ name: o.name, contact: o.contact, months: o.months, note: `Pesanan #${o.id}`, orderId: o.id })}
            onStatus={async (o, status) => {
              await call(`/api/admin/orders/${o.id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
              void reload();
            }}
            onDelete={async (o) => {
              await call(`/api/admin/orders/${o.id}`, { method: 'DELETE' });
              void reload();
            }}
          />
          <CodesPanel
            codes={codes}
            now={now}
            maxDevices={config?.maxDevices ?? 2}
            onAction={async (c, action, months) => {
              if (action === 'delete') await call(`/api/admin/codes/${c.code}`, { method: 'DELETE' });
              else await call(`/api/admin/codes/${c.code}/${action}`, { method: 'POST', body: JSON.stringify({ months }) });
              void reload();
            }}
          />
        </div>
        <div className="stack">
          <CreatePanel
            draft={draft}
            setDraft={setDraft}
            packages={config?.packages ?? [1, 3, 6, 12]}
            maxDevices={config?.maxDevices ?? 2}
            create={async (d) => {
              const made = await call<AccessCode>('/api/admin/codes', { method: 'POST', body: JSON.stringify(d) });
              if (made) void reload();
              return made;
            }}
          />
          {config && (
            <SettingsPanel
              config={config}
              save={async (patch) => {
                const next = await call<Config>('/api/admin/config', { method: 'PUT', body: JSON.stringify(patch) });
                if (next) setConfig(next);
                return !!next;
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function OrdersPanel({
  orders,
  onMake,
  onStatus,
  onDelete,
}: {
  orders: Order[] | null;
  onMake: (o: Order) => void;
  onStatus: (o: Order, s: Order['status']) => void;
  onDelete: (o: Order) => void;
}) {
  const [show, setShow] = useState<'baru' | 'semua'>('baru');
  const rows = (orders ?? []).filter((o) => show === 'semua' || o.status === 'baru');
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Pesanan masuk</h2>
        <Seg value={show} onChange={setShow} options={[{ value: 'baru', label: 'Baru' }, { value: 'semua', label: 'Semua' }]} />
      </div>
      {!orders ? (
        <Empty>
          <Spinner />
        </Empty>
      ) : rows.length ? (
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Waktu</th>
                <th>Nama</th>
                <th>WhatsApp</th>
                <th className="num">Paket</th>
                <th className="num">Total</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td className="mono warn">#{o.id}</td>
                  <td className="small nowrap">{fmtDate(o.createdAt)}</td>
                  <td>{o.name}</td>
                  <td>
                    <a href={waLink(o.contact, `Halo ${o.name}, ini admin DTY Crypto Terminal soal pesanan #${o.id}.`)} target="_blank" rel="noreferrer">
                      +{o.contact}
                    </a>
                  </td>
                  <td className="num">{o.months} bln</td>
                  <td className="num">{fmtRupiah(o.total)}</td>
                  <td>
                    <span className={`tag${o.status === 'baru' ? ' accent' : ''}`}>{o.status}</span>
                    {o.code && <div className="mono small dim">{o.code}</div>}
                  </td>
                  <td className="nowrap right">
                    {o.status === 'baru' && (
                      <>
                        <button type="button" className="btn sm primary" onClick={() => onMake(o)} title="Isi form buat kode dari pesanan ini">
                          Buat kode
                        </button>{' '}
                        <button type="button" className="btn sm ghost" onClick={() => onStatus(o, 'batal')}>
                          Batal
                        </button>
                      </>
                    )}
                    {o.status !== 'baru' && (
                      <button type="button" className="btn sm ghost" onClick={() => onDelete(o)}>
                        Hapus
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{show === 'baru' ? 'Belum ada pesanan baru.' : 'Belum ada pesanan.'}</Empty>
      )}
    </section>
  );
}

type Filter = CodeStatus | 'semua';
type Action = 'extend' | 'revoke' | 'restore' | 'reset-devices' | 'delete';

function CodesPanel({
  codes,
  now,
  maxDevices,
  onAction,
}: {
  codes: AccessCode[] | null;
  now: number;
  maxDevices: number;
  onAction: (c: AccessCode, action: Action, months?: number) => void;
}) {
  const [filter, setFilter] = useState<Filter>('aktif');
  const [q, setQ] = useState('');
  const status = (c: AccessCode): CodeStatus => (c.revoked ? 'dicabut' : c.exp <= now ? 'habis' : 'aktif');
  const rows = (codes ?? []).filter(
    (c) =>
      (filter === 'semua' || status(c) === filter) &&
      (!q || `${c.name} ${c.contact} ${c.code} ${c.note}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Pelanggan &amp; kode akses</h2>
        <div className="row">
          <input className="input" style={{ width: 160 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama / kode" />
          <Seg<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'aktif', label: 'Aktif' },
              { value: 'habis', label: 'Habis' },
              { value: 'dicabut', label: 'Dicabut' },
              { value: 'semua', label: 'Semua' },
            ]}
          />
        </div>
      </div>
      {!codes ? (
        <Empty>
          <Spinner />
        </Empty>
      ) : rows.length ? (
        <div className="table-wrap compact">
          <table>
            <thead>
              <tr>
                <th>Kode</th>
                <th>Pelanggan</th>
                <th>Berakhir</th>
                <th className="num">Sisa</th>
                <th>Status</th>
                <th className="num">Perangkat</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const st = status(c);
                const left = c.exp - now;
                return (
                  <tr key={c.code}>
                    <td className="mono nowrap">
                      {c.code}{' '}
                      <button type="button" className="icon-btn" title="Salin kode" onClick={() => copy(c.code)}>
                        ⧉
                      </button>
                    </td>
                    <td>
                      <b>{c.name}</b>
                      {c.contact && (
                        <div className="small">
                          <a href={waLink(c.contact, codeMessage(c, maxDevices))} target="_blank" rel="noreferrer" title="Kirim ulang kode lewat WhatsApp">
                            +{c.contact}
                          </a>
                        </div>
                      )}
                      {c.note && <div className="small dim">{c.note}</div>}
                    </td>
                    <td className="small nowrap">{fmtDate(c.exp)}</td>
                    <td className={`num nowrap ${st !== 'aktif' ? 'dim' : left < DAY ? 'danger' : left < 7 * DAY ? 'warn' : ''}`}>
                      {st === 'aktif' ? fmtCountdown(left, true) : '–'}
                    </td>
                    <td>
                      <span className={`tag${st === 'aktif' ? ' accent' : st === 'dicabut' ? ' danger' : ''}`}>{st}</span>
                    </td>
                    <td className="num">
                      {c.devices.length}/{maxDevices}
                    </td>
                    <td className="nowrap right">
                      <button type="button" className="btn sm" onClick={() => onAction(c, 'extend', 1)} title="Tambah 30 hari">
                        +1 bln
                      </button>{' '}
                      <button type="button" className="btn sm" onClick={() => onAction(c, 'extend', 3)} title="Tambah 90 hari">
                        +3
                      </button>{' '}
                      {c.devices.length > 0 && (
                        <>
                          <button type="button" className="btn sm ghost" onClick={() => onAction(c, 'reset-devices')} title="Keluarkan semua perangkat">
                            Reset
                          </button>{' '}
                        </>
                      )}
                      {c.revoked ? (
                        <button type="button" className="btn sm ghost" onClick={() => onAction(c, 'restore')}>
                          Pulihkan
                        </button>
                      ) : (
                        <ConfirmButton label="Cabut" question="Cabut akses?" onConfirm={() => onAction(c, 'revoke')} />
                      )}{' '}
                      <ConfirmButton label="Hapus" question="Hapus permanen?" danger onConfirm={() => onAction(c, 'delete')} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Tidak ada kode {filter === 'semua' ? '' : filter}.</Empty>
      )}
    </section>
  );
}

function CreatePanel({
  draft,
  setDraft,
  packages,
  maxDevices,
  create,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  packages: number[];
  maxDevices: number;
  create: (d: Draft) => Promise<AccessCode | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<AccessCode | null>(null);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const c = await create(draft);
    setBusy(false);
    if (c) {
      setMade(c);
      setDraft({ name: '', contact: '', months: 1, note: '' });
    }
  };
  const options = [...new Set([...packages, draft.months])].sort((a, b) => a - b);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Buat kode akses</h2>
        {draft.orderId && <span className="tag accent">pesanan #{draft.orderId}</span>}
      </div>
      <form className="stack" style={{ gap: 8 }} onSubmit={submit}>
        <label className="field">
          <span>Nama pembeli</span>
          <input id="code-name" className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} required minLength={2} maxLength={60} />
        </label>
        <label className="field">
          <span>No. WhatsApp (opsional)</span>
          <input id="code-contact" className="input" value={draft.contact} onChange={(e) => set({ contact: e.target.value })} placeholder="08…" inputMode="tel" />
        </label>
        <div className="field">
          <span>Masa aktif</span>
          <Seg<number> value={draft.months} onChange={(m) => set({ months: m })} options={options.map((m) => ({ value: m, label: `${m} bln` }))} />
        </div>
        <label className="field">
          <span>Catatan (opsional)</span>
          <input id="code-note" className="input" value={draft.note} onChange={(e) => set({ note: e.target.value })} maxLength={200} />
        </label>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'Membuat…' : `Buat kode ${draft.months} bulan (${draft.months * 30} hari)`}
        </button>
      </form>
      {made && (
        <div className="made-code">
          <div className="dim small">Kode untuk {made.name}, aktif sampai {fmtDate(made.exp)}</div>
          <div className="code-big">{made.code}</div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm" onClick={() => copy(made.code)}>
              Salin kode
            </button>
            <button type="button" className="btn sm" onClick={() => copy(codeMessage(made, maxDevices))}>
              Salin pesan
            </button>
            {made.contact && (
              <a className="btn sm primary" href={waLink(made.contact, codeMessage(made, maxDevices))} target="_blank" rel="noreferrer">
                Kirim via WhatsApp
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** datetime-local value in the admin's timezone. */
const toLocalInput = (ms: number) => {
  if (!ms) return '';
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

function SettingsPanel({ config, save }: { config: Config; save: (patch: Partial<Config>) => Promise<boolean> }) {
  const [form, setForm] = useState(config);
  const [saved, setSaved] = useState(false);
  useEffect(() => setForm(config), [config]);
  const set = (patch: Partial<Config>) => {
    setForm({ ...form, ...patch });
    setSaved(false);
  };
  const togglePackage = (m: number) =>
    set({ packages: form.packages.includes(m) ? form.packages.filter((x) => x !== m) : [...form.packages, m].sort((a, b) => a - b) });

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Pengaturan jual</h2>
      </div>
      <form
        className="stack"
        style={{ gap: 8 }}
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(await save(form));
        }}
      >
        <div className="row">
          <label className="field grow">
            <span>Harga / bulan (Rp)</span>
            <input id="cfg-price" className="input" type="number" min={0} step={1000} value={form.price} onChange={(e) => set({ price: Number(e.target.value) })} />
          </label>
          <label className="field grow">
            <span>Harga coret (opsional)</span>
            <input
              id="cfg-normal"
              className="input"
              type="number"
              min={0}
              step={1000}
              value={form.normalPrice || ''}
              placeholder="0"
              onChange={(e) => set({ normalPrice: Number(e.target.value) })}
            />
          </label>
        </div>
        <label className="field">
          <span>Promo berakhir (countdown di halaman beli)</span>
          <div className="row" style={{ gap: 6 }}>
            <input
              id="cfg-promo"
              className="input grow"
              type="datetime-local"
              value={toLocalInput(form.promoEnd)}
              onChange={(e) => set({ promoEnd: e.target.value ? new Date(e.target.value).getTime() : 0 })}
            />
            {form.promoEnd > 0 && (
              <button type="button" className="btn sm ghost" onClick={() => set({ promoEnd: 0 })}>
                Tanpa promo
              </button>
            )}
          </div>
        </label>
        <label className="field">
          <span>No. WhatsApp admin (penerima pesanan)</span>
          <input id="cfg-wa" className="input" value={form.whatsapp} onChange={(e) => set({ whatsapp: e.target.value })} placeholder="08… atau 628…" inputMode="tel" />
        </label>
        <label className="field">
          <span>Info pembayaran (rekening / QRIS / e-wallet)</span>
          <textarea
            id="cfg-pay"
            className="input"
            value={form.paymentInfo}
            onChange={(e) => set({ paymentInfo: e.target.value })}
            placeholder={'BCA 1234567890 a.n. Nama Anda\nQRIS: kirim di chat WhatsApp'}
          />
        </label>
        <div className="row">
          <label className="field">
            <span>Maks. perangkat / kode</span>
            <input id="cfg-devices" className="input" type="number" min={1} max={10} style={{ width: 90 }} value={form.maxDevices} onChange={(e) => set({ maxDevices: Number(e.target.value) })} />
          </label>
          <div className="field">
            <span>Paket di halaman beli</span>
            <div className="row" style={{ gap: 8 }}>
              {[1, 3, 6, 12].map((m) => (
                <label key={m} className="check small">
                  <input type="checkbox" checked={form.packages.includes(m)} onChange={() => togglePackage(m)} /> {m} bln
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="row">
          <button type="submit" className="btn primary">
            Simpan
          </button>
          {saved && <span className="small pos">Tersimpan. Halaman beli sudah memakai pengaturan baru.</span>}
        </div>
      </form>
    </section>
  );
}
