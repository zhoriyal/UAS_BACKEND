const express = require('express');
const db = require('../database');
const router = express.Router();

// ─── GET semua kategori tiket ─────────────────────────────────────────────────
router.get('/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM ticket_categories ORDER BY id ASC').all();
  res.json({ success: true, data: categories });
});

// ─── GET satu kategori tiket ──────────────────────────────────────────────────
router.get('/categories/:id', (req, res) => {
  const cat = db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
  res.json({ success: true, data: cat });
});

// ─── POST tambah kategori tiket (admin) ───────────────────────────────────────
router.post('/categories', (req, res) => {
  const { badge, badge_bg, badge_color, title, price, kuota, status } = req.body;
  if (!badge || !title || price == null) {
    return res.status(400).json({ success: false, message: 'badge, title, dan price wajib diisi' });
  }
  const result = db.prepare(`
    INSERT INTO ticket_categories (badge, badge_bg, badge_color, title, price, kuota, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(badge, badge_bg || '#fef3c7', badge_color || '#92400e', title, price, kuota || 500, status || 'Aktif');

  const newCat = db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'Kategori berhasil ditambahkan', data: newCat });
});

// ─── PUT edit kategori tiket (admin) ─────────────────────────────────────────
router.put('/categories/:id', (req, res) => {
  const { badge, badge_bg, badge_color, title, price, kuota, status } = req.body;
  const existing = db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });

  db.prepare(`
    UPDATE ticket_categories
    SET badge = ?, badge_bg = ?, badge_color = ?, title = ?, price = ?, kuota = ?, status = ?,
        updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    badge || existing.badge,
    badge_bg || existing.badge_bg,
    badge_color || existing.badge_color,
    title || existing.title,
    price ?? existing.price,
    kuota ?? existing.kuota,
    status || existing.status,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(req.params.id);
  res.json({ success: true, message: 'Kategori berhasil diperbarui', data: updated });
});

// ─── DELETE kategori tiket (admin) ───────────────────────────────────────────
router.delete('/categories/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM ticket_categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
  db.prepare('DELETE FROM ticket_categories WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Kategori berhasil dihapus' });
});

// ─── GET semua pemesanan tiket (admin) ───────────────────────────────────────
router.get('/bookings', (req, res) => {
  const { status, search, page = 1, limit = 10 } = req.query;
  let query = 'SELECT * FROM ticket_bookings WHERE 1=1';
  const params = [];

  if (status && status !== 'ALL') {
    query += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    query += ' AND (id LIKE ? OR nama LIKE ? OR email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const total = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as c')).get(...params).c;
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));

  const bookings = db.prepare(query).all(...params);
  res.json({
    success: true,
    data: bookings,
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) }
  });
});

// ─── GET satu pemesanan (detail) ─────────────────────────────────────────────
router.get('/bookings/:id', (req, res) => {
  const booking = db.prepare('SELECT * FROM ticket_bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
  res.json({ success: true, data: booking });
});

const { sendTicketNotification } = require('../emailService');

// ─── POST buat pemesanan tiket baru (dari Flutter app) ───────────────────────
router.post('/bookings', async (req, res) => {
  const {
    nama, email, phone,
    kategori_dewasa = 0, kategori_pelajar = 0, kategori_wna = 0,
    sesi, visit_date, payment_method = 'QRIS',
    is_mancanegara = 0
  } = req.body;

  if (!nama || !email || !sesi || !visit_date) {
    return res.status(400).json({ success: false, message: 'Nama, email, sesi, dan tanggal kunjungan wajib diisi' });
  }

  // Tentukan apakah mancanegara dari nomor telepon jika tidak diberikan langsung
  let finalIsMancanegara = Number(is_mancanegara);
  if (phone) {
    const cleanPhone = phone.trim();
    if (!cleanPhone.startsWith('+62') && !cleanPhone.startsWith('08') && !cleanPhone.startsWith('62')) {
      finalIsMancanegara = 1;
    }
  }

  // Ambil harga dari database (dinamis sesuai admin)
  const cats = db.prepare('SELECT * FROM ticket_categories WHERE status = ?').all('Aktif');
  const priceDewasa = cats.find(c => c.badge.includes('UMUM') || c.badge.includes('DEWASA'))?.price || 10000;
  const pricePelajar = cats.find(c => c.badge.includes('PELAJAR'))?.price || 5000;
  const priceWna = cats.find(c => c.badge.includes('MANCANEGARA'))?.price || 25000;

  const totalTiket = Number(kategori_dewasa) + Number(kategori_pelajar) + Number(kategori_wna);
  if (totalTiket === 0) {
    return res.status(400).json({ success: false, message: 'Pilih minimal 1 tiket' });
  }

  const totalBiaya = (Number(kategori_dewasa) * priceDewasa) + (Number(kategori_pelajar) * pricePelajar) + (Number(kategori_wna) * priceWna);

  // Generate ID unik
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const existing = db.prepare("SELECT COUNT(*) as c FROM ticket_bookings WHERE id LIKE ?").get(`#MB-${dateStr}%`);
  const seq = String(existing.c + 1).padStart(2, '0');
  const bookingId = `#MB-${dateStr}-${seq}`;

  db.prepare(`
    INSERT INTO ticket_bookings
      (id, nama, email, phone, is_mancanegara, kategori_dewasa, kategori_pelajar, kategori_wna,
       total_tiket, total_biaya, sesi, visit_date, payment_method, status, checked_in)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MENUNGGU', 0)
  `).run(bookingId, nama, email, phone || '', finalIsMancanegara, Number(kategori_dewasa), Number(kategori_pelajar), Number(kategori_wna),
         totalTiket, totalBiaya, sesi, visit_date, payment_method);

  const newBooking = db.prepare('SELECT * FROM ticket_bookings WHERE id = ?').get(bookingId);
  res.status(201).json({
    success: true,
    message: 'Pemesanan berhasil dibuat',
    data: newBooking
  });
});

// ─── PUT update status pembayaran (admin / konfirmasi) ───────────────────────
router.put(['/bookings/:id/status', '/bookings/status'], async (req, res) => {
  const { status } = req.body;
  const rawId = req.params.id || req.body.id || req.query.id;
  const valid = ['MENUNGGU', 'LUNAS', 'BATAL'];
  if (!valid.includes(status)) {
    return res.status(400).json({ success: false, message: 'Status tidak valid' });
  }

  if (!rawId) {
    return res.status(400).json({ success: false, message: 'ID pemesanan wajib diisi' });
  }

  const id = decodeURIComponent(rawId);
  let booking = db.prepare('SELECT * FROM ticket_bookings WHERE id = ?').get(id);
  if (!booking && !id.startsWith('#')) {
    booking = db.prepare('SELECT * FROM ticket_bookings WHERE id = ?').get(`#${id}`);
  }
  if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });

  const targetId = booking.id;
  db.prepare(`
    UPDATE ticket_bookings SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?
  `).run(status, targetId);

  const updated = db.prepare('SELECT * FROM ticket_bookings WHERE id = ?').get(targetId);

  // Jika status LUNAS, kirim notifikasi email berisi QR Code
  if (status === 'LUNAS') {
    sendTicketNotification({
      to: updated.email,
      nama: updated.nama,
      bookingId: updated.id,
      totalTiket: updated.total_tiket,
      totalBiaya: updated.total_biaya,
      visitDate: updated.visit_date,
      sesi: updated.sesi,
      isMancanegara: Boolean(updated.is_mancanegara),
    }).catch(err => console.error('Gagal memicu pengiriman email tiket:', err));
  }

  res.json({ success: true, message: 'Status berhasil diperbarui', data: updated });
});

// ─── PUT check-in tiket (scan QR dari admin) ─────────────────────────────────
router.put('/bookings/:id/checkin', (req, res) => {
  const booking = db.prepare('SELECT * FROM ticket_bookings WHERE id = ?').get(req.params.id);
  if (!booking) return res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
  if (booking.status !== 'LUNAS') {
    return res.status(400).json({ success: false, message: 'Tiket belum lunas, tidak dapat check-in' });
  }

  db.prepare(`
    UPDATE ticket_bookings SET checked_in = 1, status = 'LUNAS', updated_at = datetime('now','localtime') WHERE id = ?
  `).run(req.params.id);

  const updated = db.prepare('SELECT * FROM ticket_bookings WHERE id = ?').get(req.params.id);
  res.json({ success: true, message: 'Check-in berhasil', data: updated });
});

// ─── GET statistik tiket (untuk dashboard admin) ─────────────────────────────
router.get('/stats', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const totalTerjual = db.prepare("SELECT COALESCE(SUM(total_tiket), 0) as v FROM ticket_bookings WHERE status = 'LUNAS'").get().v;
  const totalPendapatan = db.prepare("SELECT COALESCE(SUM(total_biaya), 0) as v FROM ticket_bookings WHERE status = 'LUNAS'").get().v;
  const terjualHariIni = db.prepare("SELECT COALESCE(SUM(total_tiket), 0) as v FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?").get(today).v;
  const pendapatanHariIni = db.prepare("SELECT COALESCE(SUM(total_biaya), 0) as v FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?").get(today).v;
  const sudahCheckIn = db.prepare("SELECT COALESCE(SUM(total_tiket), 0) as v FROM ticket_bookings WHERE checked_in = 1 AND DATE(created_at) = ?").get(today).v;
  const menunggu = db.prepare("SELECT COUNT(*) as c FROM ticket_bookings WHERE status = 'MENUNGGU'").get().c;

  // Data mingguan (7 hari terakhir)
  const weeklyData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const row = db.prepare("SELECT COALESCE(SUM(total_tiket), 0) as v FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?").get(dateStr);
    const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    weeklyData.push({ day: days[d.getDay()], val: row.v, date: dateStr });
  }

  res.json({
    success: true,
    data: {
      totalTerjual, totalPendapatan,
      terjualHariIni, pendapatanHariIni,
      sudahCheckIn, menunggu,
      weeklyData
    }
  });
});

module.exports = router;
