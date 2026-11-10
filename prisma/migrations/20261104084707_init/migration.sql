-- CreateTable
CREATE TABLE "admins" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nama" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ticket_categories" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "badge" TEXT NOT NULL,
    "badge_bg" TEXT NOT NULL DEFAULT '#fef3c7',
    "badge_color" TEXT NOT NULL DEFAULT '#92400e',
    "title" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "kuota" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'Aktif',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ticket_bookings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nama" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "kategori_dewasa" INTEGER NOT NULL DEFAULT 0,
    "kategori_pelajar" INTEGER NOT NULL DEFAULT 0,
    "kategori_wna" INTEGER NOT NULL DEFAULT 0,
    "total_tiket" INTEGER NOT NULL DEFAULT 1,
    "total_biaya" INTEGER NOT NULL DEFAULT 0,
    "sesi" TEXT NOT NULL DEFAULT '08:00 - 10:00',
    "visit_date" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL DEFAULT 'QRIS',
    "status" TEXT NOT NULL DEFAULT 'MENUNGGU',
    "checked_in" INTEGER NOT NULL DEFAULT 0,
    "checked_in_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "koleksi" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kode" TEXT NOT NULL,
    "nama" TEXT NOT NULL,
    "sub_deskripsi" TEXT NOT NULL,
    "deskripsi_lengkap" TEXT,
    "kategori" TEXT NOT NULL DEFAULT 'Kendaraan',
    "tahun" TEXT,
    "lokasi" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DIPAMERKAN',
    "image_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ulasan" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nama" TEXT NOT NULL,
    "avatar_initial" TEXT NOT NULL DEFAULT '?',
    "avatar_color" TEXT NOT NULL DEFAULT '#3F5243',
    "category" TEXT NOT NULL DEFAULT 'Umum',
    "rating" INTEGER NOT NULL DEFAULT 5,
    "comment" TEXT NOT NULL,
    "reply" TEXT,
    "reply_date" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "otp_code" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "expired_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "koleksi_kode_key" ON "koleksi"("kode");
