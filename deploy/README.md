# Deploy ke VPS Hostinger (lewat SSH)

Panduan ini memasang DTY Crypto Terminal di **Hostinger VPS** dengan Ubuntu 24.04: Node.js menjalankan gembok akses dan
API (`server/node.mjs`), Nginx di depannya, HTTPS gratis dari Let's Encrypt. Data kode akses, pesanan, dan pengaturan
tersimpan di `/home/dty/app/.data/access.json`.

Paket hosting biasa (Web Hosting Premium/Business) tidak cocok untuk panduan ini karena tidak bisa menjalankan server
Node sendiri lewat SSH. Pakai VPS (KVM 1 sudah cukup).

Ganti `IP_VPS` dengan IP VPS Anda (hPanel → VPS → Overview) dan `domainkamu.com` dengan domain Anda.

## 1. Siapkan VPS dan domain

1. hPanel → **VPS → OS & Panel → Operating System** → pilih **Ubuntu 24.04** (OS polos, tanpa panel).
   Catat password root (bisa diganti di **VPS → Settings → Root password**).
2. hPanel → **Domains → domainkamu.com → DNS / Nameservers → DNS records**:
   - Ubah/tambah record **A** nama `@` → `IP_VPS`.
   - Ubah/tambah record **A** nama `www` → `IP_VPS`.
   - Hapus record A, AAAA, atau CNAME lama untuk `@` dan `www` yang menunjuk ke tempat lain.

   Perubahan DNS butuh 5–30 menit. Cek dengan `ping domainkamu.com`: IP yang muncul harus `IP_VPS`.

## 2. Masuk ke VPS

Di komputer Anda (Windows: **PowerShell**, Mac/Linux: **Terminal**):

```bash
ssh root@IP_VPS
```

Ketik `yes` bila ditanya, lalu masukkan password root. Semua perintah berikutnya dijalankan di dalam sesi SSH ini.

## 3. Pasang software (sebagai root)

```bash
export DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a
apt update && apt upgrade -y
apt install -y nginx git ufw certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
```

`node -v` harus menampilkan **v22.18** atau lebih baru.

## 4. Firewall

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

Jika firewall di hPanel (**VPS → Security → Firewall**) aktif, izinkan juga port 22, 80, dan 443 di sana.

## 5. Buat user aplikasi dan kunci GitHub

Aplikasi berjalan sebagai user biasa `dty`, bukan root.

```bash
adduser --disabled-password --gecos "" dty
sudo -iu dty
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C "vps-dty"
cat ~/.ssh/id_ed25519.pub
```

Salin baris yang muncul (diawali `ssh-ed25519`). Lalu di GitHub buka repo **cryptoTracking → Settings → Deploy keys →
Add deploy key**: judul `VPS Hostinger`, tempel kuncinya, **jangan** centang *Allow write access*, klik **Add key**.

## 6. Ambil kode dan build (masih sebagai `dty`)

```bash
ssh -T -o StrictHostKeyChecking=accept-new git@github.com
git clone -b claude/epic-ramanujan-osgblm git@github.com:Didik-openClaw/cryptoTracking.git ~/app
cd ~/app
npm ci
./scripts/deploy.sh
```

Perintah `ssh -T` pertama harus menjawab *"You've successfully authenticated"*. Build butuh 1–2 menit dan diakhiri
`Build selesai …`.

## 7. Password admin dan kunci sesi (masih sebagai `dty`, di `~/app`)

```bash
read -rp "Password admin (min. 10 karakter, huruf/angka saja): " PW
printf 'SESSION_SECRET=%s\nADMIN_PASSWORD=%s\n' "$(openssl rand -hex 32)" "$PW" > .env
chmod 600 .env
exit
```

`exit` mengembalikan Anda ke root. Simpan password admin di tempat aman. Untuk menggantinya nanti, edit
`/home/dty/app/.env` lalu jalankan `systemctl restart dty`.

## 8. Jalankan sebagai service (root)

```bash
cp /home/dty/app/deploy/dty.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now dty
systemctl status dty --no-pager
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8888/beli/
```

Status harus `active (running)` dan `curl` menampilkan `200`. Service otomatis hidup lagi bila VPS restart.

## 9. Nginx dan domain (root)

```bash
DOMAIN=domainkamu.com
sed "s/example\.com/$DOMAIN/g" /home/dty/app/deploy/nginx.conf > /etc/nginx/sites-available/dty
ln -sf /etc/nginx/sites-available/dty /etc/nginx/sites-enabled/dty
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Sekarang `http://domainkamu.com/beli/` sudah bisa dibuka.

## 10. HTTPS (root)

```bash
certbot --nginx -d $DOMAIN -d www.$DOMAIN --redirect
```

Isi email, setujui syarat (`Y`). Sertifikat diperpanjang otomatis. Mulai sekarang buka situs dengan `https://`.

## 11. Atur penjualan

Buka `https://domainkamu.com/admin/`, masuk dengan password admin, lalu isi **Pengaturan jual**: nomor WhatsApp, info
rekening/QRIS, harga normal dan tanggal akhir promo (untuk countdown). Coba alurnya: buka `/beli/` di HP, pesan, buat
kode di admin, aktifkan.

## 12. Perbarui data leaderboard dan berita otomatis

Snapshot leaderboard dan berita diambil saat build. Jadwalkan build ulang setiap 3 jam:

```bash
sudo -iu dty
(crontab -l 2>/dev/null; echo "17 */3 * * * /home/dty/app/scripts/deploy.sh > /home/dty/deploy.log 2>&1") | crontab -
exit
```

Build baru disiapkan di folder terpisah lalu ditukar, jadi situs tidak pernah mati saat build.

## Update kode (fitur baru)

```bash
sudo -iu dty /home/dty/app/scripts/deploy.sh --pull && systemctl restart dty
```

Pembeli tidak ter-logout karena sesi tersimpan di cookie.

## Backup data pelanggan

Dari komputer Anda:

```bash
scp root@IP_VPS:/home/dty/app/.data/access.json ./backup-akses.json
```

Aktifkan juga backup otomatis VPS di hPanel bila tersedia.

## Jika ada masalah

| Gejala | Periksa |
| --- | --- |
| `502 Bad Gateway` | Service mati: `systemctl status dty`, log: `journalctl -u dty -n 50` |
| Log berisi `Konfigurasi belum lengkap` | Isi `/home/dty/app/.env` (langkah 7), lalu `systemctl restart dty` |
| Domain tidak terbuka | DNS belum mengarah ke VPS (`ping domainkamu.com`) atau firewall (langkah 4) |
| `certbot` gagal | DNS `@` dan `www` harus sudah mengarah ke VPS sebelum langkah 10 |
| Data leaderboard tidak berubah | `cat /home/dty/deploy.log` |
| `git clone` ditolak | Deploy key belum ditambahkan di GitHub (langkah 5) |
