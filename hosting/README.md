# Deploy ke Hostinger Web Hosting (shared hosting)

Panduan untuk paket **Web Hosting** Hostinger (Premium/Business/Cloud), yang punya PHP tetapi tidak punya Node.js dan
akses root. Untuk VPS, lihat [deploy/README.md](../deploy/README.md).

Cara kerjanya:

- **GitHub Actions** membangun situs dan mengirimnya ke `public_html` lewat SSH. Ini terjadi setiap ada push dan setiap
  3 jam, supaya snapshot leaderboard dan berita tetap baru.
- **Gembok akses dan API** berjalan di PHP (`public_html/_dty/`, diatur oleh `public_html/.htaccess`). Halaman terminal
  hanya diberikan ke pengunjung yang punya sesi valid.
- **Data pribadi** (kode akses, pesanan, pengaturan, kunci sesi, hash password admin) disimpan di luar `public_html`, di
  `~/domains/dtycryptoterminal.com/dty-private/`.

Semua perintah di bawah dijalankan di **SSH Hostinger** (`ssh -p 65002 u960141073@IP`), kecuali langkah 3 yang dikerjakan
di GitHub.

## 1. Buat password admin

```bash
mkdir -p ~/domains/dtycryptoterminal.com/dty-private && chmod 700 ~/domains/dtycryptoterminal.com/dty-private
read -rsp "Password admin baru (min. 10 karakter): " PW; echo
[ ${#PW} -ge 10 ] && printf %s "$PW" | php -r 'echo password_hash(stream_get_contents(STDIN), PASSWORD_DEFAULT);' > ~/domains/dtycryptoterminal.com/dty-private/admin.hash && chmod 600 ~/domains/dtycryptoterminal.com/dty-private/admin.hash && echo "Password admin tersimpan." || echo "Terlalu pendek, ulangi perintah read di atas."
unset PW
```

Yang disimpan hanya hash-nya. Untuk mengganti password nanti, jalankan lagi dua baris terakhir.

## 2. Buat kunci SSH untuk GitHub

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -N "" -C "github-deploy" -f ~/.ssh/github_deploy
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/github_deploy
```

Perintah terakhir menampilkan **kunci privat**, dari baris `-----BEGIN OPENSSH PRIVATE KEY-----` sampai
`-----END OPENSSH PRIVATE KEY-----`. Salin semuanya untuk langkah 3, dan jangan bagikan ke siapa pun selain GitHub.

## 3. Isi secrets di GitHub

Buka repo di GitHub → **Settings → Secrets and variables → Actions → New repository secret**, lalu tambahkan:

| Name | Value |
| --- | --- |
| `HOSTINGER_HOST` | IP SSH dari hPanel → **Advanced → SSH Access** |
| `HOSTINGER_PORT` | `65002` (port SSH di halaman yang sama) |
| `HOSTINGER_USER` | `u960141073` |
| `HOSTINGER_SSH_KEY` | kunci privat dari langkah 2 (semua barisnya) |

Website dikirim ke `domains/dtycryptoterminal.com/public_html`. Untuk domain lain, buat **variable** (bukan secret)
`HOSTINGER_PATH` di tab Variables.

## 4. Jalankan deploy

GitHub → **Actions → CI → Run workflow** (branch `claude/epic-ramanujan-osgblm`) → **Run workflow**. Tunggu 2–4 menit
sampai muncul centang hijau. Di log langkah **Deploy to Hostinger** ada tulisan `Deploy selesai`.

Setelah itu deploy berjalan sendiri: setiap ada perubahan kode, dan setiap 3 jam untuk memperbarui data. Halaman bawaan
Hostinger (`default.php`) otomatis terhapus.

## 5. SSL dan HTTPS

hPanel → **Websites → dtycryptoterminal.com → Security → SSL**: pastikan SSL gratis sudah **Active**, lalu nyalakan
**Force HTTPS**.

## 6. Coba

- `https://dtycryptoterminal.com` harus pindah ke halaman beli `/beli/`.
- `https://dtycryptoterminal.com/admin/`: masuk dengan password langkah 1, lalu isi **Pengaturan jual** (nomor
  WhatsApp, info rekening/QRIS, promo).
- Buat satu kode di admin, aktifkan di `/beli/`, dan terminal akan terbuka.
- `https://dtycryptoterminal.com/demo/` adalah demo gratis.

## Backup data pelanggan

```bash
cp ~/domains/dtycryptoterminal.com/dty-private/data.json ~/backup-akses-$(date +%F).json
```

## Jika ada masalah

| Gejala | Penyebab / perbaikan |
| --- | --- |
| Admin: "Password admin belum dibuat" | Langkah 1 belum dijalankan, atau salah folder. |
| Halaman error 503 "folder dty-private…" | Jalankan baris `mkdir` di langkah 1. |
| Error 500 di semua halaman | Lihat hPanel → **Advanced → Error logs**. Kirim isinya ke saya. |
| Log Actions: `Permission denied (publickey)` | Secret `HOSTINGER_SSH_KEY`, `HOSTINGER_USER`, atau `HOSTINGER_PORT` salah, atau langkah 2 belum dijalankan. |
| Log Actions: `deploy dilewati` | Secrets di langkah 3 belum lengkap. |
| Admin terkunci "Terlalu banyak percobaan" | Tunggu 15 menit (perlindungan dari tebakan password). |
| Perubahan tidak muncul | Hapus cache browser. Jika CDN Hostinger aktif, klik **Purge cache** di hPanel. |

Opsional, untuk keamanan ekstra: simpan host key server sebagai secret `HOSTINGER_KNOWN_HOSTS` (isi dari
`ssh-keyscan -p 65002 IP` yang dijalankan di komputer Anda). Tanpa itu, GitHub menerima host key apa pun saat
terhubung.

## Untuk developer

- `npm run build:hosting` membuat `dist/` yang siap diunggah ke `public_html`. Isinya build biasa, ditambah `.htaccess`,
  `_dty/*.php`, dan salinan `.gz` untuk file terminal.
- `hosting/access.test.mjs` menjalankan tes alur jual-beli yang sama (`hosting/test/conformance.mjs`) terhadap PHP
  (`php -S` dengan `hosting/test/router.php` sebagai pengganti `.htaccess`) dan terhadap server Node.
- Format data `data.json` sama dengan versi Node (`.data/access.json`), jadi data bisa dipindah antar keduanya.
