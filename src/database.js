const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL wajib diatur untuk koneksi MySQL');
}

const connectionUrl = new URL(databaseUrl);
if (connectionUrl.protocol !== 'mysql:') {
  throw new Error('DATABASE_URL harus menggunakan protokol mysql://');
}

const pool = mysql.createPool({
  host: connectionUrl.hostname,
  port: Number(connectionUrl.port) || 3306,
  user: decodeURIComponent(connectionUrl.username),
  password: decodeURIComponent(connectionUrl.password),
  database: decodeURIComponent(connectionUrl.pathname.slice(1)),
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || 10,
  queueLimit: 0,
  timezone: 'Z',
});

async function query(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function seedTable(table, rows, insertSql) {
  const [count] = await query(`SELECT COUNT(*) AS count FROM \`${table}\``);
  if (Number(count.count) === 0) {
    for (const row of rows) {
      await query(insertSql, row);
    }
  }
}

async function initializeDatabase() {
  await query('SELECT 1');

  const [adminCount] = await query('SELECT COUNT(*) AS count FROM admins');
  if (Number(adminCount.count) === 0) {
    const passwordHash = await bcrypt.hash(process.env.ADMIN_INITIAL_PASSWORD || 'admin123', 10);
    await query(
      'INSERT INTO admins (username, password_hash, nama, role) VALUES (?, ?, ?, ?)',
      [process.env.ADMIN_INITIAL_USERNAME || 'admin', passwordHash, 'Administrator Museum', 'ADMIN'],
    );
  }

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
    'INSERT INTO koleksi (kode, nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
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
    'INSERT INTO ulasan (nama, avatar_initial, avatar_color, category, rating, comment, reply, reply_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
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

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

module.exports = { pool, query, initializeDatabase, asyncHandler };
