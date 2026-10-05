# Upload ke Hostinger

**Cara termudah:** unggah `dty-site.zip` (di folder ini) ke `public_html` lewat hPanel → File Manager,
klik kanan → **Extract** ke `public_html`, lalu hapus zip-nya. Isinya sama dengan folder `public_html/` di bawah.

Jangan pakai folder `hosting/public_html` di repo: itu hanya bahan (PHP), bukan situs lengkap.

Isi folder `public_html/` di sini adalah **situs yang sudah jadi**. Unggah **isinya** ke
`public_html` milik dtycryptoterminal.com (lewat hPanel → File Manager atau FTP).

Setelah diunggah, `public_html` di Hostinger harus berisi langsung:

```
.htaccess      (file tersembunyi, wajib ikut)
_dty/
admin/
assets/
beli/
data/
demo/
favicon.svg
index.html
index.html.gz
```

Hapus `default.php` bawaan Hostinger. Lalu ikuti langkah "Buat password admin" dan "SSL" di
[hosting/README.md](../hosting/README.md).

Folder ini diperbarui setiap kali fitur baru ditambahkan. Untuk update, unggah lagi isinya dan timpa
file lama. Data pelanggan disimpan di luar `public_html`, jadi tidak ikut terhapus.
