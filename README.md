# UAS_BACKEND

## Menjalankan backend

Gunakan Node.js 22 atau lebih baru.

Buat database MySQL lokal, lalu atur `DATABASE_URL` dan `JWT_SECRET` pada `.env`:

Contoh nilai `JWT_SECRET`:

```env
JWT_SECRET="ganti-dengan-rahasia-panjang-dan-acak"
```

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/DATABASE"
```

Terapkan skema tabel MySQL sebelum menjalankan backend:

```bash
npm install
npm run db:push
npm run dev
```

Server berjalan di `http://localhost:3001` secara default. `PORT` dapat diatur untuk mengganti port. Database dihubungkan melalui Prisma saat server dimulai; backend tidak melakukan seeding atau mengubah kredensial admin secara otomatis.

## Keamanan, error, dan logging

- Atur `CORS_ORIGINS` sebagai daftar origin browser yang dipisahkan koma (contoh: `http://localhost:3000,https://museum-kamu.vercel.app`). Di production variabel ini wajib diisi dengan origin frontend yang tepat; origin lokal hanya diizinkan saat development. CORS mengaktifkan `credentials`. Klien non-browser tanpa header `Origin` tetap dapat mengakses API.
- Jika server berjalan di belakang reverse proxy tepercaya, atur `TRUST_PROXY_HOPS=1` (atau jumlah hop tepercaya yang sesuai); nilai default `0` tidak mempercayai forwarded headers.
- Request dibatasi hingga 100 permintaan per 15 menit per alamat IP, selain batas tambahan pada endpoint autentikasi. Respons pembatasan menggunakan status `429`.
- Header `X-Request-Id` membantu menghubungkan respons dengan log. Logger Pino menyensor field password, token, cookie, dan authorization serta tidak mencatat parameter query URL.

Untuk memeriksa TypeScript dan memperbarui Prisma Client setelah mengubah skema:

```bash
npm run build
```

## Endpoint autentikasi

Semua endpoint tersedia di prefix `/api/auth`:

- `POST /register` — menerima `nama`, `email`, `password`, dan role opsional `USER` atau `STAFF`.
- `POST /login` — menerima `username` atau `email`, serta `password`.
- `POST /logout` — memerlukan header `Authorization: Bearer <token>`.
- `GET /me` — memerlukan header `Authorization: Bearer <token>`.

Password baru harus memiliki minimal 8 karakter, huruf besar, huruf kecil, dan angka. Role `ADMIN` tidak dapat dipilih melalui pendaftaran publik.
