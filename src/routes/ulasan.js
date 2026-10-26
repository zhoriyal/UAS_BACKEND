const express = require('express');
const db = require('../database');
const router = express.Router();

// ─── GET semua ulasan (dengan filter & pagination) ────────────────────────────
router.get('/', (req, res) => {
  const { search, rating, status, page = 1, limit = 10 } = req.query;
  let query = 'SELECT * FROM ulasan WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (nama LIKE ? OR comment LIKE ? OR category LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (rating && rating !== 'Semua Rating') {
    query += ' AND rating = ?';
    params.push(Number(rating));
  }
  if (status === 'Sudah Dibalas') {
    query += " AND reply IS NOT NULL AND reply != ''";
  } else if (status === 'Belum Dibalas') {
    query += " AND (reply IS NULL OR reply = '')";
  }

  const total = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as c')).get(...params).c;
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));

  const ulasan = db.prepare(query).all(...params);

  // Hitung rata-rata rating dari semua ulasan
  const avgRow = db.prepare('SELECT AVG(rating) as avg, COUNT(*) as total FROM ulasan').get();

  res.json({
    success: true,
    data: ulasan,
    stats: {
      averageRating: Math.round((avgRow.avg || 0) * 10) / 10,
      total: avgRow.total
    },
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) }
  });
});

// ─── GET satu ulasan ──────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM ulasan WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Ulasan tidak ditemukan' });
  res.json({ success: true, data: item });
});

// ─── POST kirim ulasan baru (dari Flutter app) ────────────────────────────────
router.post('/', (req, res) => {
  const { nama, rating, comment, category } = req.body;
  if (!nama || !rating || !comment) {
    return res.status(400).json({ success: false, message: 'Nama, rating, dan komentar wajib diisi' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ success: false, message: 'Rating harus antara 1 dan 5' });
  }
  if (comment.trim().length < 10) {
    return res.status(400).json({ success: false, message: 'Komentar minimal 10 karakter' });
  }

  // Generate avatar
  const initial = nama.trim()[0]?.toUpperCase() || '?';
  const colors = ['#3F5243', '#6B4C2A', '#7A5C3C', '#4A6670', '#5E4266', '#436B5A'];
  const allCount = db.prepare('SELECT COUNT(*) as c FROM ulasan').get().c;
  const color = colors[allCount % colors.length];

  const result = db.prepare(`
    INSERT INTO ulasan (nama, avatar_initial, avatar_color, category, rating, comment, reply, reply_date)
    VALUES (?, ?, ?, ?, ?, ?, '', '')
  `).run(initial, color, category || 'Kunjungan Umum', rating, comment.trim());

  // Hitung nama field yang benar
  const newUlasan = db.prepare('SELECT * FROM ulasan WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'Ulasan berhasil dikirim. Terima kasih!', data: newUlasan });
});

// ─── POST balas ulasan (dari admin) ──────────────────────────────────────────
router.post('/:id/reply', (req, res) => {
  const { reply } = req.body;
  if (!reply || reply.trim() === '') {
    return res.status(400).json({ success: false, message: 'Balasan tidak boleh kosong' });
  }

  const ulasan = db.prepare('SELECT * FROM ulasan WHERE id = ?').get(req.params.id);
  if (!ulasan) return res.status(404).json({ success: false, message: 'Ulasan tidak ditemukan' });

  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const replyDate = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  db.prepare("UPDATE ulasan SET reply = ?, reply_date = ? WHERE id = ?").run(reply.trim(), replyDate, req.params.id);

  const updated = db.prepare('SELECT * FROM ulasan WHERE id = ?').get(req.params.id);
  res.json({ success: true, message: 'Balasan berhasil dikirim', data: updated });
});

// ─── DELETE ulasan (admin) ────────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const ulasan = db.prepare('SELECT * FROM ulasan WHERE id = ?').get(req.params.id);
  if (!ulasan) return res.status(404).json({ success: false, message: 'Ulasan tidak ditemukan' });
  db.prepare('DELETE FROM ulasan WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Ulasan berhasil dihapus' });
});

module.exports = router;
