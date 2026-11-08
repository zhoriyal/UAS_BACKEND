-- CreateTable
CREATE TABLE `admins` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `nama` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'ADMIN',

    UNIQUE INDEX `admins_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nama` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'USER',

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_categories` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `badge` VARCHAR(191) NOT NULL,
    `badge_bg` VARCHAR(191) NOT NULL DEFAULT '#fef3c7',
    `badge_color` VARCHAR(191) NOT NULL DEFAULT '#92400e',
    `title` VARCHAR(191) NOT NULL,
    `price` INTEGER NOT NULL,
    `kuota` INTEGER NOT NULL DEFAULT 100,
    `status` VARCHAR(191) NOT NULL DEFAULT 'Aktif',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ticket_bookings` (
    `id` VARCHAR(191) NOT NULL,
    `nama` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `kategori_dewasa` INTEGER NOT NULL DEFAULT 0,
    `kategori_pelajar` INTEGER NOT NULL DEFAULT 0,
    `kategori_wna` INTEGER NOT NULL DEFAULT 0,
    `total_tiket` INTEGER NOT NULL DEFAULT 1,
    `total_biaya` INTEGER NOT NULL DEFAULT 0,
    `sesi` VARCHAR(191) NOT NULL DEFAULT '08:00 - 10:00',
    `visit_date` VARCHAR(191) NOT NULL,
    `payment_method` VARCHAR(191) NOT NULL DEFAULT 'QRIS',
    `status` VARCHAR(191) NOT NULL DEFAULT 'MENUNGGU',
    `checked_in` INTEGER NOT NULL DEFAULT 0,
    `checked_in_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `koleksi` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `kode` VARCHAR(191) NOT NULL,
    `nama` VARCHAR(191) NOT NULL,
    `sub_deskripsi` VARCHAR(191) NOT NULL,
    `deskripsi_lengkap` VARCHAR(191) NULL,
    `kategori` VARCHAR(191) NOT NULL DEFAULT 'Kendaraan',
    `tahun` VARCHAR(191) NULL,
    `lokasi` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'DIPAMERKAN',
    `image_url` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `koleksi_kode_key`(`kode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ulasan` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `nama` VARCHAR(191) NOT NULL,
    `avatar_initial` VARCHAR(191) NOT NULL DEFAULT '?',
    `avatar_color` VARCHAR(191) NOT NULL DEFAULT '#3F5243',
    `category` VARCHAR(191) NOT NULL DEFAULT 'Umum',
    `rating` INTEGER NOT NULL DEFAULT 5,
    `comment` VARCHAR(191) NOT NULL,
    `reply` VARCHAR(191) NULL,
    `reply_date` VARCHAR(191) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_resets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(191) NOT NULL,
    `otp_code` VARCHAR(191) NOT NULL,
    `used` INTEGER NOT NULL DEFAULT 0,
    `expired_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
