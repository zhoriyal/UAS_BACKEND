const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'museum.db');

// Pastikan folder data ada
const fs = require('fs');
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode untuk performa lebih baik
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── INISIALISASI TABEL ───────────────────────────────────────────────────────

db.exec(`
  -- Tabel Admin (untuk login admin web)
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    nama TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Tabel Kategori Tiket
  CREATE TABLE IF NOT EXISTS ticket_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    badge TEXT NOT NULL,
    badge_bg TEXT DEFAULT '#fef3c7',
    badge_color TEXT DEFAULT '#92400e',
    title TEXT NOT NULL,
    price INTEGER NOT NULL,
    kuota INTEGER NOT NULL DEFAULT 500,
    status TEXT CHECK(status IN ('Aktif','Nonaktif')) DEFAULT 'Aktif',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Tabel Users (Pengunjung / Pemesan)
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    auth_provider TEXT DEFAULT 'local', -- 'local' atau 'google'
    avatar_url TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Tabel Pemesanan Tiket
  CREATE TABLE IF NOT EXISTS ticket_bookings (
    id TEXT PRIMARY KEY,
    nama TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    is_mancanegara INTEGER DEFAULT 0,
    kategori_dewasa INTEGER DEFAULT 0,
    kategori_pelajar INTEGER DEFAULT 0,
    kategori_wna INTEGER DEFAULT 0,
    total_tiket INTEGER NOT NULL,
    total_biaya INTEGER NOT NULL,
    sesi TEXT NOT NULL,
    visit_date TEXT NOT NULL,
    payment_method TEXT DEFAULT 'QRIS',
    status TEXT CHECK(status IN ('MENUNGGU','LUNAS','BATAL')) DEFAULT 'MENUNGGU',
    checked_in INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Tabel Koleksi Museum
  CREATE TABLE IF NOT EXISTS koleksi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kode TEXT UNIQUE NOT NULL,
    nama TEXT NOT NULL,
    sub_deskripsi TEXT,
    deskripsi_lengkap TEXT,
    kategori TEXT NOT NULL,
    tahun TEXT,
    lokasi TEXT,
    status TEXT CHECK(status IN ('DIPAMERKAN','RESTORASI','SIMPAN')) DEFAULT 'DIPAMERKAN',
    image_url TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Tabel Ulasan Pengunjung
  CREATE TABLE IF NOT EXISTS ulasan (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nama TEXT NOT NULL,
    avatar_initial TEXT,
    avatar_color TEXT DEFAULT '#3F5243',
    category TEXT DEFAULT 'Kunjungan Umum',
    rating INTEGER CHECK(rating BETWEEN 1 AND 5) NOT NULL,
    comment TEXT NOT NULL,
    reply TEXT DEFAULT '',
    reply_date TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Tabel Pengumuman / Informasi
  CREATE TABLE IF NOT EXISTS pengumuman (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    status TEXT CHECK(status IN ('AKTIF','ARSIP')) DEFAULT 'AKTIF',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Tabel FAQ
  CREATE TABLE IF NOT EXISTS faq (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  -- Tabel Jam Operasional
  CREATE TABLE IF NOT EXISTS jam_operasional (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hari TEXT NOT NULL,
    jam TEXT NOT NULL,
    telepon TEXT,
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// ─── SEED DATA AWAL (jika tabel masih kosong) ─────────────────────────────────

const bcrypt = require('bcryptjs');

// Admin default
const adminCount = db.prepare('SELECT COUNT(*) as c FROM admins').get();
if (adminCount.c === 0) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO admins (username, password_hash, nama) VALUES (?, ?, ?)').run('admin', hash, 'Administrator Museum');
}

// Kategori Tiket
const catCount = db.prepare('SELECT COUNT(*) as c FROM ticket_categories').get();
if (catCount.c === 0) {
  const insertCat = db.prepare(`
    INSERT INTO ticket_categories (badge, badge_bg, badge_color, title, price, kuota, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertCat.run('UMUM / DEWASA',       '#fef3c7', '#92400e', 'Tiket Reguler (WNI Dewasa)',         10000, 500, 'Aktif');
  insertCat.run('PELAJAR / MAHASISWA', '#dbeafe', '#1e40af', 'Tiket Pelajar / Rombongan (WNI)',    5000,  300, 'Aktif');
  insertCat.run('MANCANEGARA',         '#f3e8ff', '#6b21a8', 'Tiket Wisatawan Asing (WNA)',        25000, 100, 'Aktif');
}

// Koleksi Museum
const koleksiCount = db.prepare('SELECT COUNT(*) as c FROM koleksi').get();
if (koleksiCount.c === 0) {
  const insertKoleksi = db.prepare(`
    INSERT INTO koleksi (kode, nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertKoleksi.run('#INV-MB-001', 'Gerbong Maut', 'Peninggalan Peristiwa 1947', 'Gerbong kereta api yang menjadi saksi bisu tragedi Peristiwa Gerbong Maut 1947, di mana 46 pejuang kemerdekaan Indonesia tewas dalam kondisi gerbong yang sangat sesak dan panas. Kini dipajang sebagai monumen bersejarah.', 'Kendaraan', '1947', 'Halaman Depan', 'DIPAMERKAN', 'assets/images/collection/menu_gerbong_maut.png');
  insertKoleksi.run('#INV-MB-002', 'Senjata Katana Jepang', 'Rampasan Tentara Jepang', 'Pedang katana peninggalan tentara Jepang yang berhasil dirampas oleh pejuang kemerdekaan Indonesia pada masa pendudukan Jepang (1942-1945).', 'Senjata', '1942', 'Gedung Utama (Lantai 1)', 'DIPAMERKAN', null);
  insertKoleksi.run('#INV-MB-003', 'Dokumen Peta Strategi Perang', 'Arsip Otentik Panglima', 'Dokumen taktik dan denah pertahanan militer era perang kemerdekaan Indonesia. Dokumen otentik yang digunakan oleh panglima militer dalam merencanakan strategi pertempuran.', 'Dokumen', '1945', 'Ruang Arsip Khusus', 'RESTORASI', 'assets/images/collection/peta_operasi_militer.png');
  insertKoleksi.run('#INV-MB-004', 'Meriam Si Jagur', 'Artileri Berat Pertahanan', 'Meriam berat yang digunakan sebagai artileri pertahanan wilayah Jawa Timur pada masa perjuangan kemerdekaan. Merupakan salah satu koleksi paling ikonik museum.', 'Senjata', '1943', 'Halaman Depan', 'DIPAMERKAN', null);
  insertKoleksi.run('#INV-MB-005', 'Seragam Dinas Jenderal', 'Pakaian Otentik Perwira', 'Seragam dinas resmi jenderal TNI era kemerdekaan. Dibuat dari bahan berkualitas tinggi dan masih dalam kondisi terawat baik.', 'Pakaian', '1950', 'Gedung Utama (Lantai 2)', 'DIPAMERKAN', null);
  insertKoleksi.run('#INV-MB-006', 'Tank Amfibi', 'Kendaraan Perang Darat-Air', 'Tank amfibi yang mampu beroperasi di darat maupun perairan, digunakan dalam operasi militer masa kemerdekaan untuk mengamankan wilayah kepulauan.', 'Kendaraan', '1948', 'Halaman Belakang', 'DIPAMERKAN', null);
  insertKoleksi.run('#INV-MB-007', 'Perahu Segigir', 'Armada Laut Perjuangan', 'Perahu tradisional yang dimodifikasi untuk keperluan militer. Digunakan oleh pejuang kemerdekaan untuk patroli dan pengiriman logistik melalui jalur laut.', 'Kendaraan', '1946', 'Area Pameran Luar', 'DIPAMERKAN', 'assets/images/collection/menu_perahu_segigir.png');
  insertKoleksi.run('#INV-MB-008', 'Mobil Dinas Letkol', 'Kendaraan Resmi Komandan', 'Mobil dinas resmi milik Letnan Kolonel yang digunakan sebagai transportasi komandan militer dalam operasi lapangan. Merupakan kendaraan bersejarah dengan nilai historis tinggi.', 'Kendaraan', '1950', 'Gedung Utama (Lantai 1)', 'DIPAMERKAN', 'assets/images/collection/menu_mobil_dinas_letkol.png');
}

// Ulasan awal
const ulasanCount = db.prepare('SELECT COUNT(*) as c FROM ulasan').get();
if (ulasanCount.c === 0) {
  const insertUlasan = db.prepare(`
    INSERT INTO ulasan (nama, avatar_initial, avatar_color, category, rating, comment, reply, reply_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
  `);
  insertUlasan.run('Budi Santoso',  'B', '#3F5243', 'Kunjungan Umum',    5, 'Museum yang sangat edukatif! Koleksinya lengkap dan terjaga dengan baik. Sangat direkomendasikan untuk kunjungan keluarga dan pelajar.', 'Terima kasih Budi! Kami senang mendengar pengalaman positif Anda. Sampai jumpa kembali!', '10 Oktober 2026');
  insertUlasan.run('Siti Rahayu',   'S', '#6B4C2A', 'Kunjungan Umum',    5, 'Tempat bersejarah yang wajib dikunjungi. Gerbong Maut dan Diorama Pertempuran sangat mengesankan. Staf ramah dan informatif.', 'Terima kasih Siti atas ulasannya! Kami bangga koleksi kami dapat memberikan kesan mendalam.', '5 Oktober 2026');
  insertUlasan.run('Ahmad Fauzi',   'A', '#7A5C3C', 'Kunjungan Pelajar', 4, 'Koleksinya luar biasa dan penuh nilai sejarah. Suasana museum sangat tenang dan nyaman untuk belajar sejarah perjuangan bangsa.', '', '');
  insertUlasan.run('Pandu Aji',     'P', '#4A6670', 'Kunjungan Umum',    5, 'Kunjungan yang sangat edukatif! Koleksi artefak sejarah perjuangan tersusun rapi. Pemesanan tiket online sangat praktis.', 'Terima kasih mas Pandu! Kami senang kemudahan reservasi tiket memberikan pengalaman kunjungan yang berkesan.', '29 September 2026');
  insertUlasan.run('Rayhan',        'R', '#5E4266', 'Kunjungan Pelajar', 4, 'Sangat bagus untuk edukasi siswa. Mohon pencahayaan di area koleksi dokumen sejarah bisa diterangkan lagi.', '', '');
  insertUlasan.run('Jordan',        'J', '#436B5A', 'Wisatawan Mancanegara', 5, 'Great historical museum with rich military collections. Very friendly staff and clean environment!', 'Thank you so much Jordan! We are glad you enjoyed our collections.', '25 September 2026');
}

// Pengumuman
const pengumumanCount = db.prepare('SELECT COUNT(*) as c FROM pengumuman').get();
if (pengumumanCount.c === 0) {
  const insertP = db.prepare('INSERT INTO pengumuman (title, description, category, date, status) VALUES (?, ?, ?, ?, ?)');
  insertP.run('Jadwal Operasional Khusus Hari Libur Nasional', 'Museum tetap buka pada tanggal merah kecuali hari Senin.', 'Informasi Umum', '25 Sep 2026', 'AKTIF');
  insertP.run('Pameran Khusus Artefak Perjuangan Malang Raya', 'Pameran tematik di Gedung Utama Lantai 2.', 'Agenda Event', '18 Sep 2026', 'AKTIF');
  insertP.run('Pemeliharaan Area Koleksi Kendaraan Berat', 'Sebagian area luar ruangan ditutup sementara untuk perbaikan.', 'Pemeliharaan', '02 Sep 2026', 'ARSIP');
}

// FAQ
const faqCount = db.prepare('SELECT COUNT(*) as c FROM faq').get();
if (faqCount.c === 0) {
  const insertFaq = db.prepare('INSERT INTO faq (question, answer) VALUES (?, ?)');
  insertFaq.run('Apakah harus membeli tiket secara online terlebih dahulu?', 'Pengunjung dapat membeli tiket secara online di situs ini maupun langsung secara OTS di loket.');
  insertFaq.run('Apakah diperbolehkan membawa kamera profesional ke dalam area museum?', 'Diperbolehkan dengan syarat tidak menggunakan flash pada koleksi bersejarah tertentu yang sensitif cahaya.');
  insertFaq.run('Berapa lama waktu kunjungan yang direkomendasikan?', 'Kami merekomendasikan waktu kunjungan minimal 2-3 jam untuk menikmati seluruh koleksi dengan optimal.');
}

// Jam Operasional
const jamCount = db.prepare('SELECT COUNT(*) as c FROM jam_operasional').get();
if (jamCount.c === 0) {
  db.prepare('INSERT INTO jam_operasional (hari, jam, telepon) VALUES (?, ?, ?)').run('Selasa - Minggu (Senin Libur)', '08:00 - 15:00 WIB', '(0341) 551502');
}

module.exports = db;
