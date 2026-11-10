const express = require('express');
const { query, asyncHandler } = require('../database');
const router = express.Router();

router.get('/summary', asyncHandler(async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const [[sales], [revenue], [collection], transactions, reviews, [reviewCount], pending] = await Promise.all([
    query("SELECT COALESCE(SUM(total_tiket), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?", [today]),
    query("SELECT COALESCE(SUM(total_biaya), 0) AS value FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?", [today]),
    query('SELECT COUNT(*) AS total FROM koleksi'),
    query(`
      SELECT id, nama AS name, total_tiket AS tickets, total_biaya AS total, status,
        DATE(created_at) AS date
      FROM ticket_bookings ORDER BY created_at DESC LIMIT 5
    `),
    query(`
      SELECT id, nama AS user, rating, comment, created_at AS date
      FROM ulasan ORDER BY created_at DESC LIMIT 2
    `),
    query("SELECT COUNT(*) AS total FROM ulasan WHERE reply = '' OR reply IS NULL"),
    query(`
      SELECT id, nama, total_tiket FROM ticket_bookings
      WHERE status = 'MENUNGGU' ORDER BY created_at DESC LIMIT 5
    `),
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
      terjualHariIni: Number(sales.value),
      pendapatanHariIni: Number(revenue.value),
      totalKoleksi: collection.total,
      transactions,
      reviews,
      weeklyData,
      notifications: {
        pendingBookings: pending,
        ulasanBelumDibalas: reviewCount.total,
        hasUnread: pending.length > 0 || Number(reviewCount.total) > 0,
      },
    },
  });
}));

module.exports = router;
