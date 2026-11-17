# UAS_BACKEND

## Menjalankan backend

Gunakan Node.js 22 atau lebih baru.

Buat database MySQL lokal, lalu salin `.env.example` menjadi `.env` dan atur `DATABASE_URL` serta `JWT_SECRET`. File `.env` tidak boleh dimasukkan ke Git:

Contoh nilai `JWT_SECRET`:

```env
JWT_SECRET="ganti-dengan-rahasia-panjang-dan-acak"
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/DATABASE"
```

Untuk cloud, gunakan hostname MySQL publik dari provider (bukan `localhost`/XAMPP), izinkan koneksi jaringan dari layanan backend, dan URL-encode karakter khusus pada username/password. Jika provider mensyaratkan TLS, tambahkan `sslaccept=strict` ke `DATABASE_URL`; bila CA khusus diperlukan, simpan sertifikat sebagai file di `prisma/` dan tambahkan `sslcert=<nama-file>&sslaccept=strict`. Kedua opsi dipakai oleh Prisma dan mysql2. Hindari `sslaccept=accept_invalid_certs` untuk production.

Terapkan skema tabel MySQL sebelum menjalankan backend:

```bash
npm install
npm run db:migrate
npm run dev
```

Sebelum menjalankan seeder, atur `ADMIN_INITIAL_PASSWORD` di PowerShell lalu jalankan perintah berikut:

```powershell
$env:ADMIN_INITIAL_PASSWORD = "<password-admin>"
npm run db:seed
```

Seeder membuat atau memperbarui akun admin utama (`admin@museum.com`) dengan password dari `ADMIN_INITIAL_PASSWORD`, nama `Administrator`, dan role internal `SUPERADMIN` (Super Admin). Password di-hash memakai bcrypt rounds 10. Seeder hanya mengubah akun tersebut dan tidak menghapus akun admin lain. Jalankan ulang dengan mengatur variabel environment tersebut setiap kali ingin menerapkan ulang password.

Server berjalan di `http://localhost:3001` secara default. `PORT` dapat diatur untuk mengganti port. Database dihubungkan melalui Prisma saat server dimulai; kredensial admin tidak diubah otomatis ketika backend dijalankan.

## Keamanan, error, dan logging

- Atur `CORS_ORIGINS` sebagai daftar origin browser yang dipisahkan koma. Untuk deployment ini gunakan `https://museum-brawijaya-admin.vercel.app,http://localhost:3000`. CORS mengaktifkan `credentials`. Klien non-browser tanpa header `Origin` tetap dapat mengakses API.
- Jika server berjalan di belakang reverse proxy tepercaya, atur `TRUST_PROXY_HOPS=1` (atau jumlah hop tepercaya yang sesuai); nilai default `0` tidak mempercayai forwarded headers.
- Request dibatasi hingga 100 permintaan per 15 menit per alamat IP, selain batas tambahan pada endpoint autentikasi. Respons pembatasan menggunakan status `429`.
- Header `X-Request-Id` membantu menghubungkan respons dengan log. Logger Pino menyensor field password, token, cookie, dan authorization serta tidak mencatat parameter query URL.

Untuk memeriksa TypeScript dan memperbarui Prisma Client setelah mengubah skema:

```bash
npm run build
```

### Deploy backend ke Render

Blueprint di `../render.yaml` membuat Node Web Service dari folder `UAS_BACKEND`, menjalankan health check di `/api/health`, dan mengatur CORS untuk admin Vercel serta localhost. Buat database MySQL cloud lebih dulu, lalu saat Render meminta environment variables isi `DATABASE_URL` dengan connection URL dari provider, `JWT_SECRET` dengan nilai acak kuat, serta `ADMIN_INITIAL_PASSWORD` dengan password admin kuat. Masukkan key Production Midtrans; blueprint menetapkan `MIDTRANS_IS_PRODUCTION=true`. Setelah Render memberikan domain publik, isi `PUBLIC_API_URL` dengan domain itu (tanpa `/api`).

Setelah database cloud dapat dijangkau dari backend, jalankan migrasi dan seed akun dari Shell layanan Render:

```bash
npm run db:migrate
npm run db:seed
```

Jangan gunakan XAMPP/`localhost` sebagai `DATABASE_URL` di cloud. `src/app.ts` adalah entry point yang dipakai `npm start`; `src/app.js` merupakan entry point lama dan tidak dipakai blueprint. Setelah seed berhasil, hapus `ADMIN_INITIAL_PASSWORD` dari environment layanan.

## Pembayaran dan e-tiket

Atur `MIDTRANS_SERVER_KEY`, `MIDTRANS_CLIENT_KEY`, dan `MIDTRANS_IS_PRODUCTION` (`false` untuk sandbox, `true` untuk production) pada environment backend. Di production, aplikasi menolak startup bila mode bukan production, key tidak lengkap/masih memakai Server Key Sandbox, atau `CORS_ORIGINS` belum diatur. Simpan key Production dari dashboard Midtrans hanya di environment backend, jangan di source code atau environment frontend. `PUBLIC_API_URL` wajib diisi dengan URL publik backend yang dipakai sebagai tautan PDF tiket.

Atur URL notifikasi di dashboard Midtrans ke `https://<domain-backend>/api/payments/webhook` (bukan domain frontend Vercel). Pastikan backend memakai MySQL production dan jalankan `npm run db:migrate` sebelum menerima pembayaran. Frontend/admin Vercel perlu `NEXT_PUBLIC_API_URL=https://<domain-backend>/api` dan `API_URL=https://<domain-backend>/api`; backend perlu `CORS_ORIGINS=https://museum-brawijaya-admin.vercel.app,http://localhost:3000`.

Webhook utama memverifikasi notifikasi lewat Midtrans Core API dan, untuk `settlement` atau `capture` dengan `fraud_status=accept`, memperbarui `tickets`, `transactions`, dan `ticket_bookings` dalam satu transaksi MySQL. Endpoint kompatibilitas `/api/payments/notification` tetap tersedia untuk checkout lama aplikasi mobile dan memperbarui status booking.

- `POST /api/tickets/checkout` — menerima `bookingId`, `paymentMethod` (`QRIS` atau `VIRTUAL_ACCOUNT`), dan `bank` opsional (`bca`, `bni`, `bri`, `mandiri`, `permata`, `cimb` untuk VA). Nominal selalu diambil dari pemesanan yang tersimpan.
- `POST /api/payments/create-transaction` (alias: `/api/payment/create-transaction`) — menerima `bookingId` dan membuat Snap token berdasarkan nominal pemesanan di database.
- `POST /api/payments/webhook` — memverifikasi notifikasi melalui Midtrans Core API dan memperbarui status tiket/transaksi.
- `GET /api/tickets/files/:filename` — mengunduh PDF bertiket QR setelah pembayaran terverifikasi.

Checkout menggunakan pemesanan yang lebih dulu dibuat melalui `POST /api/tiket/bookings`. Jalankan `npm run db:migrate` setelah konfigurasi database agar tabel pembayaran baru dibuat.

## Endpoint autentikasi

Semua endpoint tersedia di prefix `/api/auth`:

- `POST /register` — menerima `nama`, `email`, `password`, dan role opsional `USER` atau `STAFF`.
- `POST /login` — menerima `username` atau `email`, serta `password`.
- `POST /logout` — memerlukan header `Authorization: Bearer <token>`.
- `GET /me` — memerlukan header `Authorization: Bearer <token>`.

Password baru harus memiliki minimal 8 karakter, huruf besar, huruf kecil, dan angka. Role `ADMIN` tidak dapat dipilih melalui pendaftaran publik.

## Kuis kecocokan artefak

Atur `GEMINI_API_KEY` hanya di environment backend. Jangan simpan kunci ini di aplikasi mobile. Jalankan `npm run db:migrate` agar tabel `artifact_quiz_results` tersedia sebelum memakai kuis.

- `POST /api/ai/artifact-match` — endpoint publik untuk aplikasi pengunjung, dibatasi hingga 10 permintaan per IP per 15 menit. Body berisi `{"answers":["jawaban pertanyaan 1","jawaban pertanyaan 2","jawaban pertanyaan 3"]}`; setiap jawaban harus cocok dengan pilihan kuis. Respons sukses memuat `matched_artifact`, `ai_explanation`, dan `created_at`. Jawaban dan hasil disimpan ke tabel `artifact_quiz_results`.
- `GET /api/ai/artifact-matches?limit=25` — melihat statistik dan riwayat kecocokan; memerlukan token Bearer dengan role `ADMIN`, `SUPERADMIN`, atau `STAFF`. Nilai `limit` dibatasi hingga 100.

## Generator deskripsi AI

`POST /api/ai/generate-description` menerima `{"title":"...","category":"..."}` dan menghasilkan `{ "description": "..." }`. Endpoint ini memerlukan role `ADMIN`, `SUPERADMIN`, atau `STAFF` serta `GEMINI_API_KEY` yang valid di environment backend.

## Balasan ulasan

- `PUT /api/ulasan/:id/reply` — menyimpan balasan admin untuk ulasan yang cocok dengan `id`. Memerlukan token Bearer dengan role `ADMIN`, `SUPERADMIN`, atau `STAFF`, serta body JSON `{"reply":"..."}`. Balasan tidak boleh kosong; respons sukses menyertakan ulasan yang telah diperbarui.
