-- Safe non-destructive migration for users profile & avatar columns on MySQL / MariaDB
SET @db_name = DATABASE();

-- 1. Pastikan kolom avatar_url tersedia dengan panjang 500 karakter untuk URL Vercel Blob
SET @has_avatar = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'avatar_url'
);
SET @sql_avatar = IF(
  @has_avatar = 0,
  'ALTER TABLE `users` ADD COLUMN `avatar_url` VARCHAR(500) NULL AFTER `role`',
  'ALTER TABLE `users` MODIFY COLUMN `avatar_url` VARCHAR(500) NULL'
);
PREPARE stmt_avatar FROM @sql_avatar;
EXECUTE stmt_avatar;
DEALLOCATE PREPARE stmt_avatar;

-- 2. Pastikan kolom auth_provider tersedia
SET @has_provider = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'auth_provider'
);
SET @sql_provider = IF(
  @has_provider = 0,
  'ALTER TABLE `users` ADD COLUMN `auth_provider` VARCHAR(50) NOT NULL DEFAULT ''local'' AFTER `password_hash`',
  'SELECT 1'
);
PREPARE stmt_provider FROM @sql_provider;
EXECUTE stmt_provider;
DEALLOCATE PREPARE stmt_provider;

-- 3. Pastikan kolom created_at tersedia
SET @has_created = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'created_at'
);
SET @sql_created = IF(
  @has_created = 0,
  'ALTER TABLE `users` ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)',
  'SELECT 1'
);
PREPARE stmt_created FROM @sql_created;
EXECUTE stmt_created;
DEALLOCATE PREPARE stmt_created;

-- 4. Pastikan kolom updated_at tersedia
SET @has_updated = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db_name AND TABLE_NAME = 'users' AND COLUMN_NAME = 'updated_at'
);
SET @sql_updated = IF(
  @has_updated = 0,
  'ALTER TABLE `users` ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
  'SELECT 1'
);
PREPARE stmt_updated FROM @sql_updated;
EXECUTE stmt_updated;
DEALLOCATE PREPARE stmt_updated;
