const express = require('express');
const { query, asyncHandler } = require('../database');
const { sendTicketNotification } = require('../emailService');
const router = express.Router();

router.get('/categories', asyncHandler(async (_req, res) => {
  const categories = await query('SELECT * FROM ticket_categories ORDER BY id ASC');
  res.json({ success: true, data: categories });
}));

router.get('/categories/:id', asyncHandler(async (req, res) => {
  const [category] = await query('SELECT * FROM ticket_categories WHERE id = ?', [req.params.id]);
  if (!category) {
    res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
    return;
  }
  res.json({ success: true, data: category });
}));

router.post('/categories', asyncHandler(async (req, res) => {
  const { badge, badge_bg, badge_color, title, price, kuota, status } = req.body;
  if (!badge || !title || price == null) {
    res.status(400).json({ success: false, message: 'badge, title, dan price wajib diisi' });
    return;
  }
  const result = await query(`
    INSERT INTO ticket_categories (badge, badge_bg, badge_color, title, price, kuota, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [badge, badge_bg || '#fef3c7', badge_color || '#92400e', title, price, kuota || 500, status || 'Aktif']);
  const [newCategory] = await query('SELECT * FROM ticket_categories WHERE id = ?', [result.insertId]);
  res.status(201).json({ success: true, message: 'Kategori berhasil ditambahkan', data: newCategory });
}));

router.put('/categories/:id', asyncHandler(async (req, res) => {
  const [existing] = await query('SELECT * FROM ticket_categories WHERE id = ?', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
    return;
  }
  const { badge, badge_bg, badge_color, title, price, kuota, status } = req.body;
  await query(`
    UPDATE ticket_categories
    SET badge = ?, badge_bg = ?, badge_color = ?, title = ?, price = ?, kuota = ?, status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    badge || existing.badge,
    badge_bg || existing.badge_bg,
    badge_color || existing.badge_color,
    title || existing.title,
    price ?? existing.price,
    kuota ?? existing.kuota,
    status || existing.status,
    req.params.id,
  ]);
  const [updated] = await query('SELECT * FROM ticket_categories WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Kategori berhasil diperbarui', data: updated });
}));

router.delete('/categories/:id', asyncHandler(async (req, res) => {
  const [existing] = await query('SELECT * FROM ticket_categories WHERE id = ?', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Kategori tidak ditemukan' });
    return;
  }
  await query('DELETE FROM ticket_categories WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Kategori berhasil dihapus' });
}));

router.get('/bookings', asyncHandler(async (req, res) => {
  const { status, search, page = 1, limit = 10 } = req.query;
  let where = ' FROM ticket_bookings WHERE 1=1';
  const params = [];
  if (status && status !== 'ALL') {
    where += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    where += ' AND (id LIKE ? OR nama LIKE ? OR email LIKE ?)';
    const value = `%${search}%`;
    params.push(value, value, value);
  }

  const [{ total }] = await query(`SELECT COUNT(*) AS total${where}`, params);
  const pageNumber = Number(page);
  const pageSize = Number(limit);
  const bookings = await query(
    `SELECT *${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (pageNumber - 1) * pageSize],
  );
  res.json({
    success: true,
    data: bookings,
    pagination: { total, page: pageNumber, limit: pageSize, totalPages: Math.ceil(total / pageSize) },
  });
}));

router.get('/bookings/:id', asyncHandler(async (req, res) => {
  const [booking] = await query('SELECT * FROM ticket_bookings WHERE id = ?', [req.params.id]);
  if (!booking) {
    res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
    return;
  }
  res.json({ success: true, data: booking });
}));

router.post('/bookings', asyncHandler(async (req, res) => {
  const {
    nama, email, phone,
    kategori_dewasa = 0, kategori_pelajar = 0, kategori_wna = 0,
    sesi, visit_date, payment_method = 'QRIS',
    is_mancanegara = 0,
  } = req.body;

  if (!nama || !email || !sesi || !visit_date) {
    res.status(400).json({ success: false, message: 'Nama, email, sesi, dan tanggal kunjungan wajib diisi' });
    return;
  }

  let finalIsMancanegara = Number(is_mancanegara);
  if (phone) {
    const cleanPhone = phone.trim();
    if (!cleanPhone.startsWith('+62') && !cleanPhone.startsWith('08') && !cleanPhone.startsWith('62')) {
      finalIsMancanegara = 1;
    }
  }

  const categories = await query('SELECT * FROM ticket_categories WHERE status = ?', ['Aktif']);
  const priceAdult = categories.find((category) => category.badge.includes('UMUM') || category.badge.includes('DEWASA'))?.price || 10000;
  const priceStudent = categories.find((category) => category.badge.includes('PELAJAR'))?.price || 5000;
  const priceInternational = categories.find((category) => category.badge.includes('MANCANEGARA'))?.price || 25000;
  const adultCount = Number(kategori_dewasa);
  const studentCount = Number(kategori_pelajar);
  const internationalCount = Number(kategori_wna);
  const totalTickets = adultCount + studentCount + internationalCount;
  if (totalTickets === 0) {
    res.status(400).json({ success: false, message: 'Pilih minimal 1 tiket' });
    return;
  }

  const totalCost = adultCount * priceAdult + studentCount * priceStudent + internationalCount * priceInternational;
  const dateString = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const [existing] = await query(
    'SELECT COUNT(*) AS total FROM ticket_bookings WHERE id LIKE ?',
    [`#MB-${dateString}%`],
  );
  const sequence = String(Number(existing.total) + 1).padStart(2, '0');
  const bookingId = `#MB-${dateString}-${sequence}`;

  await query(`
    INSERT INTO ticket_bookings
      (id, nama, email, phone, is_mancanegara, kategori_dewasa, kategori_pelajar, kategori_wna,
       total_tiket, total_biaya, sesi, visit_date, payment_method, status, checked_in)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'MENUNGGU', 0)
  `, [
    bookingId, nama, email, phone || '', finalIsMancanegara, adultCount, studentCount, internationalCount,
    totalTickets, totalCost, sesi, visit_date, payment_method,
  ]);

  const [newBooking] = await query('SELECT * FROM ticket_bookings WHERE id = ?', [bookingId]);
  res.status(201).json({ success: true, message: 'Pemesanan berhasil dibuat', data: newBooking });
}));

router.put(['/bookings/:id/status', '/bookings/status'], asyncHandler(async (req, res) => {
  const { status } = req.body;
  const rawId = req.params.id || req.body.id || req.query.id;
  if (!['MENUNGGU', 'LUNAS', 'BATAL'].includes(status)) {
    res.status(400).json({ success: false, message: 'Status tidak valid' });
    return;
  }
  if (!rawId) {
    res.status(400).json({ success: false, message: 'ID pemesanan wajib diisi' });
    return;
  }

  const id = decodeURIComponent(rawId);
  let [booking] = await query('SELECT * FROM ticket_bookings WHERE id = ?', [id]);
  if (!booking && !id.startsWith('#')) {
    [booking] = await query('SELECT * FROM ticket_bookings WHERE id = ?', [`#${id}`]);
  }
  if (!booking) {
    res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
    return;
  }

  await query(
    'UPDATE ticket_bookings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [status, booking.id],
  );
  const [updated] = await query('SELECT * FROM ticket_bookings WHERE id = ?', [booking.id]);

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
    }).catch((error) => console.error('Gagal memicu pengiriman email tiket:', error));
  }

  res.json({ success: true, message: 'Status berhasil diperbarui', data: updated });
}));

router.put('/bookings/:id/checkin', asyncHandler(async (req, res) => {
  const [booking] = await query('SELECT * FROM ticket_bookings WHERE id = ?', [req.params.id]);
  if (!booking) {
    res.status(404).json({ success: false, message: 'Pemesanan tidak ditemukan' });
    return;
  }
  if (booking.status !== 'LUNAS') {
    res.status(400).json({ success: false, message: 'Tiket belum lunas, tidak dapat check-in' });
    return;
  }

  await query(`
    UPDATE ticket_bookings
    SET checked_in = 1, status = 'LUNAS', updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [req.params.id]);
  const [updated] = await query('SELECT * FROM ticket_bookings WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Check-in berhasil', data: updated });
}));

router.get('/stats', asyncHandler(async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const [
    [totalSold],
    [totalRevenue],
    [soldToday],
    [revenueToday],
    [checkedIn],
    [pending],
  ] = await Promise.all([
    query("SELECT COALESCE(SUM(total_tiket), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS'"),
    query("SELECT COALESCE(SUM(total_biaya), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS'"),
    query("SELECT COALESCE(SUM(total_tiket), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?", [today]),
    query("SELECT COALESCE(SUM(total_biaya), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?", [today]),
    query('SELECT COALESCE(SUM(total_tiket), 0) AS value FROM ticket_bookings WHERE checked_in = 1 AND DATE(created_at) = ?', [today]),
    query("SELECT COUNT(*) AS total FROM ticket_bookings WHERE status = 'MENUNGGU'"),
  ]);

  const weeklyData = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateString = date.toISOString().slice(0, 10);
    const [row] = await query(`
      SELECT COALESCE(SUM(total_tiket), 0) AS value
      FROM ticket_bookings
      WHERE status = 'LUNAS' AND DATE(created_at) = ?
    `, [dateString]);
    const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    weeklyData.push({ day: days[date.getDay()], val: Number(row.value), date: dateString });
  }

  res.json({
    success: true,
    data: {
      totalTerjual: Number(totalSold.value),
      totalPendapatan: Number(totalRevenue.value),
      terjualHariIni: Number(soldToday.value),
      pendapatanHariIni: Number(revenueToday.value),
      sudahCheckIn: Number(checkedIn.value),
      menunggu: pending.total,
      weeklyData,
    },
  });
}));

module.exports = router;
