const express = require('express');
const db = require('../database');
const router = express.Router();

/**
 * GET /api/dashboard/summary
 * Mengembalikan semua data ringkasan untuk halaman dashboard admin
 */
router.get('/summary', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  // Data tiket
  const terjualHariIni = db.prepare("SELECT COALESCE(SUM(total_tiket), 0) as v FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?").get(today).v;
  const pendapatanHariIni = db.prepare("SELECT COALESCE(SUM(total_biaya), 0) as v FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?").get(today).v;

  // Total koleksi
  const totalKoleksi = db.prepare("SELECT COUNT(*) as c FROM koleksi").get().c;

  // Transaksi terbaru (5 terakhir)
  const transactions = db.prepare(`
    SELECT id, nama as name, total_tiket as tickets, total_biaya as total, status,
           DATE(created_at) as date
    FROM ticket_bookings ORDER BY created_at DESC LIMIT 5
  `).all();

  // Ulasan terbaru (2 terakhir)
  const reviews = db.prepare(`
    SELECT id, nama as user, rating, comment, created_at as date
    FROM ulasan ORDER BY created_at DESC LIMIT 2
  `).all();

  // Grafik mingguan
  const weeklyData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const row = db.prepare("SELECT COALESCE(SUM(total_tiket), 0) as v FROM ticket_bookings WHERE status = 'LUNAS' AND DATE(created_at) = ?").get(dateStr);
    const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
    weeklyData.push({ day: days[d.getDay()], val: row.v, date: dateStr });
  }

  // Notifikasi (pemesanan menunggu)
  const pending = db.prepare("SELECT id, nama, total_tiket FROM ticket_bookings WHERE status = 'MENUNGGU' ORDER BY created_at DESC LIMIT 5").all();
  const ulasanBelumDibalas = db.prepare("SELECT COUNT(*) as c FROM ulasan WHERE reply = '' OR reply IS NULL").get().c;

  res.json({
    success: true,
    data: {
      terjualHariIni, pendapatanHariIni, totalKoleksi,
      transactions, reviews, weeklyData,
      notifications: {
        pendingBookings: pending,
        ulasanBelumDibalas,
        hasUnread: pending.length > 0 || ulasanBelumDibalas > 0
      }
    }
  });
});

module.exports = router;
