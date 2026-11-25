-- Izinkan password_hash bernilai NULL untuk pengguna yang login via Google OAuth (tanpa merusak data user lokal)
ALTER TABLE `users` MODIFY COLUMN `password_hash` VARCHAR(191) NULL;
