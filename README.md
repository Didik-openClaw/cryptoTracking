# DTY Crypto Terminal: Pelacak Posisi Jumbo Hyperliquid

Website untuk mencari dan memantau trader di jaringan **Hyperliquid** yang memegang posisi perp bernilai jutaan dollar:
siapa yang **LONG**, siapa yang **SHORT**, berapa besar, kapan posisinya dibuka, di harga berapa masuk, di mana likuidasinya,
dan trade besar apa yang sedang terjadi saat ini.

Tampilannya bergaya terminal Bloomberg: command line `GO`, menu fungsi bernomor (tekan `1`–`6`, atau `/` untuk mengetik),
ticker harga berjalan, jam JKT/UTC/NY, dan status line di bawah.

| Kode | Fungsi |
| --- | --- |
| `WHAL` (1) | Scanner Whale |
| `LSHT` (2) | Long vs Short per coin |
| `TOPW` (3) | Top 20 whale paling profit |
| `BLKT` (4) | Trade besar live |
| `WTCH` (5) | Watchlist & alert |
| `PREF` (6) | Pengaturan |

Ketik alamat `0x…`, nama coin (`BTC`), atau kode fungsi di command line lalu tekan `GO`.

Tema **Gelap** (default), **Terang**, atau **Auto** (mengikuti pengaturan perangkat) bisa dipilih dari tombol di header atau
di Pengaturan; chart ikut berganti warna dan pilihan disimpan di browser.

Website ini statis (HTML + JavaScript) dan tidak butuh server. Semua data diambil langsung dari API publik Hyperliquid oleh
browser pengunjung.

## Fitur

| Halaman | Isi |
| --- | --- |
| **Scanner Whale** (`#/`) | Semua posisi ≥ $5M (bisa diubah: $100K s/d $50M). Total LONG vs SHORT, rasio, uPnL, posisi yang dekat likuidasi, ringkasan Long vs Short per coin, whale dengan eksposur terbesar, dan tabel lengkap (waktu posisi dibuka, size, nilai, entry, mark, harga likuidasi, jarak likuidasi, leverage, uPnL, ROE, equity) yang bisa difilter dan diurutkan. |
| **Long vs Short** (`#/coins`) | Per coin: total whale long/short, jumlah wallet, net, porsi dari open interest, rata-rata entry, uPnL tiap sisi, funding, dan OI. |
| **Detail coin** (`#/coin/BTC`) | Daftar "Siapa yang LONG" dan "Siapa yang SHORT", chart candlestick dengan garis entry dan likuidasi whale, serta **peta likuidasi** (berapa nilai posisi yang terlikuidasi jika harga turun/naik ke level tertentu). |
| **Top Whale** (`#/top`) | 20 wallet whale paling profit (PnL atau ROI 24 jam/7 hari/30 hari/semua waktu). Whale = akun ≥ $1M, akun ≥ $10M, atau sedang memegang posisi jumbo. Per wallet: win rate, profit factor, jumlah trade (menang/kalah), rata-rata menang/kalah, expectancy, trade terbaik/terburuk, rata-rata lama pegang posisi, bias long/short, posisi saat ini. Ringkasan: total PnL, median win rate & profit factor, net posisi top whale, dan coin terbesar di posisi mereka. |
| **Panel Berita & Wire** (di samping chart) | Di halaman coin dan tab Chart Trade wallet. **BERITA**: headline kripto terbaru (CoinDesk Data API, cadangan CryptoCompare, lalu snapshot RSS CoinDesk/Cointelegraph/The Block/Decrypt dari build), otomatis difilter ke coin yang dibuka atau ke Hyperliquid, refresh tiap 2 menit, dengan sentimen dan ringkasan. **WIRE**: kabar real-time dari data Hyperliquid: blok trade whale, posisi whale baru, harga bergerak tajam dalam 15 menit, funding ekstrem, lonjakan open interest, dan whale yang mendekati likuidasi. |
| **Live Trade Besar** (`#/live`) | Market order ≥ $1M secara real-time lewat websocket. Fill-fill kecil dari satu order digabung jadi satu baris. Ditampilkan juga posisi trader saat ini, maker terbesar, arus beli/jual 5 menit/15 menit/1 jam, dan trader paling agresif. Trader yang masuk besar otomatis ikut dipindai scanner. |
| **Detail wallet** (`#/wallet/0x…`) | Nilai akun, leverage efektif, grafik PnL/equity (24 jam/7 hari/30 hari/semua), semua posisi, chart trade dengan marker beli/jual, open order (termasuk TP/SL), riwayat trade (2000 fill terakhir), funding, deposit/withdraw/transfer, saldo spot, dan statistik (volume, win rate, PnL terealisasi, fee, likuidasi). |
| **Watchlist & Alert** (`#/watchlist`) | Simpan wallet favorit dan beri nama. Alert muncul untuk setiap trade, buka/tutup/tambah/kurangi posisi, balik arah, posisi yang mendekati likuidasi, dan (opsional) whale baru dari scanner. Notifikasi dikirim lewat browser, bunyi, dan log. Watchlist bisa di-import/export. |
| **Pengaturan** (`#/settings`) | Jumlah akun yang dipindai, kecepatan request, threshold, interval refresh, dan status koneksi. |

## Cara kerja

Hyperliquid tidak punya endpoint "daftar semua posisi besar", jadi website ini membangun daftarnya sendiri:

1. **Daftar akun** diambil dari leaderboard publik Hyperliquid (`stats-data.hyperliquid.xyz/Mainnet/leaderboard`). Saat build,
   `scripts/fetch-leaderboard.mjs` menyimpan salinan ringkas (8.000 akun terbesar) ke `data/leaderboard.json`, sehingga browser
   tidak perlu mengunduh file leaderboard yang besar. Kalau salinan itu tidak ada atau sudah lama, browser mengambil leaderboard
   langsung dari Hyperliquid.
2. **Scanner** memanggil `clearinghouseState` untuk setiap akun, dimulai dari nilai akun terbesar (default 1.500 akun ≥ $100K).
   Wallet yang sudah diketahui memegang posisi jumbo di-refresh setiap 60 detik. Akun lain dipindai bergiliran terus-menerus.
3. **Websocket** (`wss://api.hyperliquid.xyz/ws`) dipakai untuk harga real-time (`allMids`), trade besar (`trades`), dan trade
   wallet watchlist (`userFills`, maksimal 10 wallet sesuai batas Hyperliquid). Taker dari trade besar otomatis masuk antrean
   scanner, jadi whale yang tidak ada di leaderboard tetap bisa ketemu.
4. **Rate limit**: Hyperliquid mengizinkan 1.200 bobot request per menit per IP. Website ini memakai 800 per menit secara default
   dan selalu menyisakan cadangan untuk aksi yang kamu klik, supaya halaman wallet tetap cepat walau scanner sedang berjalan.

5. **Waktu buka posisi** tidak disediakan API Hyperliquid, jadi direkonstruksi dari riwayat fill wallet: fill terakhir yang
   membawa posisi dari nol (atau dari sisi sebaliknya) ke posisi sekarang. Ini dicari otomatis untuk 40 baris teratas tabel,
   memakai paling banyak ±30% kuota request, dan disimpan di browser. Kalau posisi lebih tua dari 2000 fill terakhir yang
   disediakan API, tampil sebagai "> tanggal".

6. **Win rate & profit factor** dihitung dari 2000 fill terakhir tiap wallet. Fill disusun ulang menjadi trade utuh (posisi
   dibuka sampai ditutup atau dibalik). Win rate = trade profit ÷ trade selesai; profit factor = total profit trade menang ÷
   total rugi trade kalah (sebelum fee). Posisi yang sudah terbuka sebelum fill tertua tidak dihitung sampai ditutup.

Hasil scan, watchlist, alert, waktu buka posisi, statistik trader, dan pengaturan disimpan di `localStorage` browser.

### Keterbatasan

- Alert hanya aktif selama tab website terbuka (boleh di background). Tidak ada server yang memantau 24/7.
- Scanner hanya menemukan whale yang ada di leaderboard (default 1.500 akun teratas) atau yang ketahuan trade besar di live feed.
  Naikkan "Jumlah akun yang dipindai" di Pengaturan untuk cakupan lebih luas, dengan konsekuensi satu putaran scan jadi lebih lama.
- Riwayat trade per wallet dibatasi API Hyperliquid: 2000 fill terbaru.
- Hanya perp di DEX utama Hyperliquid (bukan pasar HIP-3).
- Berita memakai API publik pihak ketiga. Tanpa API key berlaku batas request gratis; isi key CoinDesk Data di Pengaturan
  bila perlu. Kalau API tidak bisa diakses, dipakai snapshot RSS dari build terakhir (paling lama 3 jam).

## Menjalankan di komputer sendiri

Butuh Node.js 22.18 atau lebih baru.

```bash
npm install
npm run data     # opsional: unduh snapshot leaderboard & berita ke public/data/
npm run dev      # terminal tanpa gembok akses: http://localhost:5173
```

Tanpa koneksi ke Hyperliquid (misalnya jaringan diblokir), coba **mode demo** dengan pasar simulasi:

```bash
npm run dev:demo         # buka http://localhost:5173/demo/
```

Mode demo menampilkan banner "Mode demo". Semua angka dan alamat di dalamnya (berawalan `0xdeadbeef`) adalah simulasi.
Build produksi tidak memuat kode demo.

Mencoba alur jual-beli akses lengkap di komputer sendiri (gembok, halaman beli, admin):

```bash
npm run build:pages
ADMIN_PASSWORD=rahasia npm run serve:local   # http://localhost:8888 (data di .data/access.json)
```

Perintah lain:

```bash
npm test             # unit test
npm run build        # build produksi ke dist/ (termasuk unduh snapshot leaderboard & berita)
```

## Jual akses (Rp 500.000 / bulan)

Situs ini dijual per bulan dengan **kode akses**. Gembok berjalan di server (Netlify), jadi file aplikasi tidak dikirim ke
browser yang belum punya kode valid.

| Alamat | Untuk | Isi |
| --- | --- | --- |
| `/` | pembeli | Terminal. Tanpa akses, pengunjung otomatis diarahkan ke `/beli/`. Header menampilkan countdown sisa akses. |
| `/beli/` | publik | Harga, harga coret, countdown promo, paket 1/3/6/12 bulan, form pesan → WhatsApp admin, info pembayaran, kolom aktivasi kode, status akses & tombol perpanjang. |
| `/demo/` | publik | Demo gratis dengan pasar simulasi. |
| `/admin/` | Anda | Pesanan masuk, buat kode akses per bulan + kirim via WhatsApp, daftar pelanggan dengan countdown sisa akses, perpanjang, cabut/pulihkan, reset perangkat, dan pengaturan harga/promo/nomor WA/info bayar. |

**Alur jual:** pembeli isi form di `/beli/` → pesanan tercatat di admin dan WhatsApp Anda terbuka dengan nomor pesanan →
pembeli transfer/QRIS dan kirim bukti → Anda klik **Buat kode** di pesanan → **Kirim via WhatsApp** → pembeli masukkan kode
→ terminal terbuka. Perpanjangan: klik **+1 bln** di admin; kode yang sama langsung bertambah 30 hari.

Aturan akses:

- 1 bulan = 30 hari. Saat kode habis, terminal mengarahkan pembeli ke halaman perpanjang.
- Satu kode bisa dipakai di 2 perangkat (bisa diubah di admin). "Keluar dari perangkat ini" atau **Reset** di admin membebaskan slot.
- Kode yang dicabut berhenti bekerja saat terminal dibuka/dimuat ulang, paling lambat 24 jam.

### Setup di Netlify (gratis, repo tetap private)

1. Daftar di [netlify.com](https://www.netlify.com/) → **Add new site → Import an existing project → GitHub** → pilih repo ini
   dan branch `claude/epic-ramanujan-osgblm`. Pengaturan build otomatis terbaca dari `netlify.toml`.
2. Sebelum deploy, buka **Site configuration → Environment variables** dan tambahkan:
   - `SESSION_SECRET`: teks acak panjang (minimal 32 karakter), misalnya hasil `openssl rand -hex 32`.
   - `ADMIN_PASSWORD`: password panel admin, buat yang kuat.
3. Deploy. Buka `https://<nama-situs>.netlify.app/admin/`, masuk dengan `ADMIN_PASSWORD`, lalu isi **Pengaturan jual**:
   nomor WhatsApp, info rekening/QRIS, dan tanggal berakhir promo (untuk countdown).
4. Opsional, agar snapshot leaderboard & berita diperbarui tiap 3 jam: di Netlify buat **Build hook**, lalu simpan URL-nya
   sebagai secret `NETLIFY_BUILD_HOOK` di GitHub (**Settings → Secrets and variables → Actions**).

Data kode akses, pesanan, dan pengaturan disimpan di Netlify Blobs (penyimpanan bawaan Netlify, tidak perlu database).
Mengganti `SESSION_SECRET` mengeluarkan semua pembeli dari sesinya; kode akses tetap berlaku dan bisa dimasukkan lagi.

Jangan deploy situs ini ke hosting statis biasa (GitHub Pages dll.): di sana tidak ada gembok, sehingga terminal terbuka
untuk semua orang.

### Batasan penjualan

- Data berasal dari API publik Hyperliquid; yang dijual adalah kemudahan dan analisis di terminal ini. Demo publik memuat
  kode aplikasi yang sama dengan pasar simulasi.
- Pembayaran dicek manual oleh Anda (transfer/QRIS lewat WhatsApp). Untuk pembayaran otomatis perlu payment gateway
  (Midtrans/Xendit) dan akun merchant.

## Struktur kode

```
src/
  lib/            logika & data (tanpa React)
    api.ts          client API Hyperliquid + rate limiter
    ws.ts           websocket dengan auto-reconnect
    leaderboard.ts  sumber daftar akun
    scanner.ts      mesin scanner posisi
    live.ts         live feed trade besar (aggregator.ts: gabung fill per order)
    watchlist.ts    watchlist, polling, alert (alerts.ts: deteksi perubahan posisi)
    market.ts       harga, funding, open interest
  components/     komponen UI (tabel, chart, header)
  pages/          halaman terminal
  beli/           halaman beli (publik)
  admin/          panel admin
server/access.ts                kode akses, sesi, gembok & API (dipakai Netlify dan server lokal)
netlify/edge-functions/gate.ts  gembok di depan semua file terminal
netlify/functions/api.mts       /api/* (login, pesanan, admin) + penyimpanan Netlify Blobs
scripts/fetch-leaderboard.mjs   snapshot leaderboard saat build
scripts/fetch-news.mjs          snapshot berita RSS saat build
scripts/serve-local.mjs         tiruan Netlify untuk mencoba alur jual-beli secara lokal
```

---

Data publik dari Hyperliquid. Bukan saran finansial.
