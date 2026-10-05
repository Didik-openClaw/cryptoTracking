# Upload ke Hostinger

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
