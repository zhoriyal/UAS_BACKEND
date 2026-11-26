import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL wajib diatur');
}

const isSqliteUrl = databaseUrl.startsWith('file:');

let pool: mysql.Pool;
if (!isSqliteUrl) {
  const connectionUrl = new URL(databaseUrl);

  const sslAcceptance = connectionUrl.searchParams.get('sslaccept');
  if (sslAcceptance && !['strict', 'accept_invalid_certs'].includes(sslAcceptance)) {
    throw new Error('Parameter DATABASE_URL sslaccept harus strict atau accept_invalid_certs');
  }
  const sslCertPath = connectionUrl.searchParams.get('sslcert');
  const ssl = sslAcceptance || sslCertPath
    ? {
        rejectUnauthorized: sslAcceptance !== 'accept_invalid_certs',
        ...(sslCertPath
          ? { ca: fs.readFileSync(path.resolve(__dirname, '../prisma', sslCertPath), 'utf8') }
          : {}),
      }
    : undefined;

  pool = mysql.createPool({
    host: connectionUrl.hostname,
    port: Number(connectionUrl.port) || 3306,
    user: decodeURIComponent(connectionUrl.username),
    password: decodeURIComponent(connectionUrl.password),
    database: decodeURIComponent(connectionUrl.pathname.slice(1)),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: 0,
    timezone: 'Z',
    ssl,
  });
} else {
  // Placeholder pool agar ekspor `pool` tetap valid saat berjalan penuh di SQLite
  pool = null as unknown as mysql.Pool;
}

export { pool };

import { DatabaseSync } from 'node:sqlite';

let sqliteDb: DatabaseSync | null = null;
let useSqliteFallback = isSqliteUrl;

function getSqliteDb(): DatabaseSync {
  if (!sqliteDb) {
    const dbPath = path.resolve(__dirname, '../prisma/data/museum.db');
    sqliteDb = new DatabaseSync(dbPath);
  }
  return sqliteDb;
}

function adaptSqlForSqlite(sql: string): string {
  return sql
    .replace(/\bNOW\(\)/gi, 'CURRENT_TIMESTAMP')
    .replace(/\bAUTO_INCREMENT\b/gi, 'AUTOINCREMENT');
}

export async function query<T = any>(sql: string, params: unknown[] = []): Promise<T> {
  if (!useSqliteFallback) {
    try {
      const [result] = await pool.execute(sql, params as any[]);
      return result as T;
    } catch (err: any) {
      if (err?.code === 'ECONNREFUSED' || err?.errno === -4078) {
        useSqliteFallback = true;
        console.warn('[Database] MySQL tidak aktif (ECONNREFUSED), beralih otomatis ke SQLite lokal (prisma/data/museum.db).');
      } else {
        throw err;
      }
    }
  }

  const db = getSqliteDb();
  const adapted = adaptSqlForSqlite(sql).trim();
  const stmt = db.prepare(adapted);
  const safeParams = params.map((p) => (p === undefined ? null : p)) as any[];
  if (/^(SELECT|PRAGMA|SHOW|WITH)\b/i.test(adapted)) {
    return stmt.all(...safeParams) as unknown as T;
  }
  const info = stmt.run(...safeParams);
  return {
    insertId: Number(info.lastInsertRowid || 0),
    affectedRows: Number(info.changes || 0),
  } as unknown as T;
}

async function seedTable(table: string, rows: unknown[][], insertSql: string) {
  const [count] = await query<any[]>(`SELECT COUNT(*) AS count FROM \`${table}\``);
  if (Number(count?.count) === 0) {
    for (const row of rows) {
      await query(insertSql, row);
    }
  }
}

export async function ensureUserProfileColumns() {
  // Pastikan kolom profil pengguna ada pada tabel users MySQL tanpa merusak data yang sudah ada
  const columns = await query<Array<{ Field: string; Type?: string; Null?: string }>>('SHOW COLUMNS FROM `users`');
  const colMap = new Map(columns.map((col) => [col.Field, col]));

  // Pastikan password_hash boleh NULL agar pengguna Google OAuth bisa terdaftar tanpa password lokal
  const passwordCol = colMap.get('password_hash');
  if (passwordCol && passwordCol.Null === 'NO') {
    await query('ALTER TABLE `users` MODIFY COLUMN `password_hash` VARCHAR(191) NULL');
  }

  const avatarCol = colMap.get('avatar_url');
  if (!avatarCol) {
    await query('ALTER TABLE `users` ADD COLUMN `avatar_url` VARCHAR(500) NULL');
  } else if (avatarCol.Type && /^varchar\((\d+)\)$/i.test(avatarCol.Type)) {
    const match = avatarCol.Type.match(/^varchar\((\d+)\)$/i);
    if (match && Number(match[1]) < 500) {
      await query('ALTER TABLE `users` MODIFY COLUMN `avatar_url` VARCHAR(500) NULL');
    }
  }

  if (!colMap.has('auth_provider')) {
    await query('ALTER TABLE `users` ADD COLUMN `auth_provider` VARCHAR(50) NOT NULL DEFAULT "local"');
  }

  if (!colMap.has('created_at')) {
    await query('ALTER TABLE `users` ADD COLUMN `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)');
  }

  if (!colMap.has('updated_at')) {
    await query(
      'ALTER TABLE `users` ADD COLUMN `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)',
    );
  }
}

export async function ensureAdminProfileColumns() {
  // Pastikan kolom profil admin (foto profil, jabatan, telepon) ada di tabel admins tanpa merusak data
  const columns = await query<Array<{ Field: string; Type?: string }>>('SHOW COLUMNS FROM `admins`');
  const colMap = new Map(columns.map((col) => [col.Field, col]));

  const avatarCol = colMap.get('avatar_url');
  if (!avatarCol) {
    await query('ALTER TABLE `admins` ADD COLUMN `avatar_url` VARCHAR(500) NULL');
  } else if (avatarCol.Type && /^varchar\((\d+)\)$/i.test(avatarCol.Type)) {
    const match = avatarCol.Type.match(/^varchar\((\d+)\)$/i);
    if (match && Number(match[1]) < 500) {
      await query('ALTER TABLE `admins` MODIFY COLUMN `avatar_url` VARCHAR(500) NULL');
    }
  }

  if (!colMap.has('jabatan')) {
    await query('ALTER TABLE `admins` ADD COLUMN `jabatan` VARCHAR(120) NULL');
  }

  if (!colMap.has('phone')) {
    await query('ALTER TABLE `admins` ADD COLUMN `phone` VARCHAR(40) NULL');
  }
}

export function isSqliteMode(): boolean {
  return useSqliteFallback;
}

/** Membuat tabel notifikasi admin (pemesanan tiket & ulasan baru) bila belum ada. */
export async function ensureNotificationsTable() {
  if (useSqliteFallback) {
    await query(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT,
      reference_id TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    return;
  }
  await query(`CREATE TABLE IF NOT EXISTS notifications (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    type VARCHAR(30) NOT NULL,
    title VARCHAR(191) NOT NULL,
    message TEXT NOT NULL,
    link VARCHAR(191) NULL,
    reference_id VARCHAR(191) NULL,
    is_read TINYINT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
  )`);
}

export async function initializeDatabase() {
  await query('SELECT 1');

  try {
    await ensureNotificationsTable();
  } catch (err) {
    console.warn('[Database] Gagal menyiapkan tabel notifications:', err);
  }

  const [adminCount] = await query<any[]>('SELECT COUNT(*) AS count FROM admins');
  if (Number(adminCount?.count) === 0) {
    const passwordHash = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD || 'admin123', 10);
    await query(
      'INSERT INTO admins (username, password_hash, nama, role) VALUES (?, ?, ?, ?)',
      [process.env.ADMIN_INITIAL_USERNAME || 'admin', passwordHash, 'Administrator Museum', 'ADMIN'],
    );
  }

  try {
    await ensureUserProfileColumns();
  } catch (_) {}

  try {
    await ensureAdminProfileColumns();
  } catch (_) {}

  await seedTable(
    'ticket_categories',
    [
      ['UMUM / DEWASA', '#fef3c7', '#92400e', 'Tiket Reguler (WNI Dewasa)', 10000, 500, 'Aktif'],
      ['PELAJAR / MAHASISWA', '#dbeafe', '#1e40af', 'Tiket Pelajar / Rombongan (WNI)', 5000, 300, 'Aktif'],
      ['MANCANEGARA', '#f3e8ff', '#6b21a8', 'Tiket Wisatawan Asing (WNA)', 25000, 100, 'Aktif'],
    ],
    'INSERT INTO ticket_categories (badge, badge_bg, badge_color, title, price, kuota, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  await seedTable(
    'koleksi',
    [
      ['#INV-MB-001', 'Gerbong Maut', 'Peninggalan Peristiwa 1947', 'Gerbong kereta api yang menjadi saksi bisu tragedi Peristiwa Gerbong Maut 1947, di mana 46 pejuang kemerdekaan Indonesia tewas dalam kondisi gerbong yang sangat sesak dan panas. Kini dipajang sebagai monumen bersejarah.', 'Kendaraan', '1947', 'Halaman Depan', 'DIPAMERKAN', 'assets/images/collection/menu_gerbong_maut.png'],
      ['#INV-MB-002', 'Senjata Katana Jepang', 'Rampasan Tentara Jepang', 'Pedang katana peninggalan tentara Jepang yang berhasil dirampas oleh pejuang kemerdekaan Indonesia pada masa pendudukan Jepang (1942-1945).', 'Senjata', '1942', 'Gedung Utama (Lantai 1)', 'DIPAMERKAN', null],
      ['#INV-MB-003', 'Dokumen Peta Strategi Perang', 'Arsip Otentik Panglima', 'Dokumen taktik dan denah pertahanan militer era perang kemerdekaan Indonesia. Dokumen otentik yang digunakan oleh panglima militer dalam merencanakan strategi pertempuran.', 'Dokumen', '1945', 'Ruang Arsip Khusus', 'RESTORASI', 'assets/images/collection/peta_operasi_militer.png'],
      ['#INV-MB-004', 'Meriam Si Jagur', 'Artileri Berat Pertahanan', 'Meriam berat yang digunakan sebagai artileri pertahanan wilayah Jawa Timur pada masa perjuangan kemerdekaan. Merupakan salah satu koleksi paling ikonik museum.', 'Senjata', '1943', 'Halaman Depan', 'DIPAMERKAN', null],
      ['#INV-MB-005', 'Seragam Dinas Jenderal', 'Pakaian Otentik Perwira', 'Seragam dinas resmi jenderal TNI era kemerdekaan. Dibuat dari bahan berkualitas tinggi dan masih dalam kondisi terawat baik.', 'Pakaian', '1950', 'Gedung Utama (Lantai 2)', 'DIPAMERKAN', null],
      ['#INV-MB-006', 'Tank Amfibi', 'Kendaraan Perang Darat-Air', 'Tank amfibi yang mampu beroperasi di darat maupun perairan, digunakan dalam operasi militer masa kemerdekaan untuk mengamankan wilayah kepulauan.', 'Kendaraan', '1948', 'Halaman Belakang', 'DIPAMERKAN', null],
      ['#INV-MB-007', 'Perahu Segigir', 'Armada Laut Perjuangan', 'Perahu tradisional yang dimodifikasi untuk keperluan militer. Digunakan oleh pejuang kemerdekaan untuk patroli dan pengiriman logistik melalui jalur laut.', 'Kendaraan', '1946', 'Area Pameran Luar', 'DIPAMERKAN', 'assets/images/collection/menu_perahu_segigir.png'],
      ['#INV-MB-008', 'Mobil Dinas Letkol', 'Kendaraan Resmi Komandan', 'Mobil dinas resmi milik Letnan Kolonel yang digunakan sebagai transportasi komandan militer dalam operasi lapangan. Merupakan kendaraan bersejarah dengan nilai historis tinggi.', 'Kendaraan', '1950', 'Gedung Utama (Lantai 1)', 'DIPAMERKAN', 'assets/images/collection/menu_mobil_dinas_letkol.png'],
    ],
    'INSERT INTO koleksi (kode, nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
  );

  await seedTable(
    'ulasan',
    [
      ['Budi Santoso', 'B', '#3F5243', 'Kunjungan Umum', 5, 'Museum yang sangat edukatif! Koleksinya lengkap dan terjaga dengan baik. Sangat direkomendasikan untuk kunjungan keluarga dan pelajar.', 'Terima kasih Budi! Kami senang mendengar pengalaman positif Anda. Sampai jumpa kembali!', '10 Oktober 2026'],
      ['Siti Rahayu', 'S', '#6B4C2A', 'Kunjungan Umum', 5, 'Tempat bersejarah yang wajib dikunjungi. Gerbong Maut dan Diorama Pertempuran sangat mengesankan. Staf ramah dan informatif.', 'Terima kasih Siti atas ulasannya! Kami bangga koleksi kami dapat memberikan kesan mendalam.', '5 Oktober 2026'],
      ['Ahmad Fauzi', 'A', '#7A5C3C', 'Kunjungan Pelajar', 4, 'Koleksinya luar biasa dan penuh nilai sejarah. Suasana museum sangat tenang dan nyaman untuk belajar sejarah perjuangan bangsa.', '', ''],
      ['Pandu Aji', 'P', '#4A6670', 'Kunjungan Umum', 5, 'Kunjungan yang sangat edukatif! Koleksi artefak sejarah perjuangan tersusun rapi. Pemesanan tiket online sangat praktis.', 'Terima kasih mas Pandu! Kami senang kemudahan reservasi tiket memberikan pengalaman kunjungan yang berkesan.', '29 September 2026'],
      ['Rayhan', 'R', '#5E4266', 'Kunjungan Pelajar', 4, 'Sangat bagus untuk edukasi siswa. Mohon pencahayaan di area koleksi dokumen sejarah bisa diterangkan lagi.', '', ''],
      ['Jordan', 'J', '#436B5A', 'Wisatawan Mancanegara', 5, 'Great historical museum with rich military collections. Very friendly staff and clean environment!', 'Thank you so much Jordan! We are glad you enjoyed our collections.', '25 September 2026'],
    ],
    'INSERT INTO ulasan (nama, avatar_initial, avatar_color, category, rating, comment, reply, reply_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
  );

  await seedTable(
    'pengumuman',
    [
      ['Jadwal Operasional Khusus Hari Libur Nasional', 'Museum tetap buka pada tanggal merah kecuali hari Senin.', 'Informasi Umum', '25 Sep 2026', 'AKTIF'],
      ['Pameran Khusus Artefak Perjuangan Malang Raya', 'Pameran tematik di Gedung Utama Lantai 2.', 'Agenda Event', '18 Sep 2026', 'AKTIF'],
      ['Pemeliharaan Area Koleksi Kendaraan Berat', 'Sebagian area luar ruangan ditutup sementara untuk perbaikan.', 'Pemeliharaan', '02 Sep 2026', 'ARSIP'],
    ],
    'INSERT INTO pengumuman (title, description, category, date, status) VALUES (?, ?, ?, ?, ?)',
  );

  await seedTable(
    'faq',
    [
      ['Apakah harus membeli tiket secara online terlebih dahulu?', 'Pengunjung dapat membeli tiket secara online di situs ini maupun langsung secara OTS di loket.'],
      ['Apakah diperbolehkan membawa kamera profesional ke dalam area museum?', 'Diperbolehkan dengan syarat tidak menggunakan flash pada koleksi bersejarah tertentu yang sensitif cahaya.'],
      ['Berapa lama waktu kunjungan yang direkomendasikan?', 'Kami merekomendasikan waktu kunjungan minimal 2-3 jam untuk menikmati seluruh koleksi dengan optimal.'],
    ],
    'INSERT INTO faq (question, answer) VALUES (?, ?)',
  );

  await seedTable(
    'jam_operasional',
    [['Selasa - Minggu (Senin Libur)', '08:00 - 15:00 WIB', '(0341) 551502']],
    'INSERT INTO jam_operasional (hari, jam, telepon) VALUES (?, ?, ?)',
  );
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export default { pool, query, initializeDatabase, asyncHandler };
