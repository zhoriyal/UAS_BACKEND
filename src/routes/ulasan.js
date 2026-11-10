const express = require('express');
const { query, asyncHandler } = require('../database');
const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { search, rating, status, page = 1, limit = 10 } = req.query;
  let where = ' FROM ulasan WHERE 1=1';
  const params = [];

  if (search) {
    where += ' AND (nama LIKE ? OR comment LIKE ? OR category LIKE ?)';
    const value = `%${search}%`;
    params.push(value, value, value);
  }
  if (rating && rating !== 'Semua Rating') {
    where += ' AND rating = ?';
    params.push(Number(rating));
  }
  if (status === 'Sudah Dibalas') {
    where += " AND reply IS NOT NULL AND reply != ''";
  } else if (status === 'Belum Dibalas') {
    where += " AND (reply IS NULL OR reply = '')";
  }

  const [{ total }] = await query(`SELECT COUNT(*) AS total${where}`, params);
  const pageNumber = Number(page);
  const pageSize = Number(limit);
  const data = await query(
    `SELECT *${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (pageNumber - 1) * pageSize],
  );
  const [stats] = await query('SELECT AVG(rating) AS average, COUNT(*) AS total FROM ulasan');

  res.json({
    success: true,
    data,
    stats: {
      averageRating: Math.round(Number(stats.average || 0) * 10) / 10,
      total: stats.total,
    },
    pagination: { total, page: pageNumber, limit: pageSize, totalPages: Math.ceil(total / pageSize) },
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const [item] = await query('SELECT * FROM ulasan WHERE id = ?', [req.params.id]);
  if (!item) {
    res.status(404).json({ success: false, message: 'Ulasan tidak ditemukan' });
    return;
  }
  res.json({ success: true, data: item });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nama, rating, comment, category } = req.body;
  if (!nama || !rating || !comment) {
    res.status(400).json({ success: false, message: 'Nama, rating, dan komentar wajib diisi' });
    return;
  }
  if (rating < 1 || rating > 5) {
    res.status(400).json({ success: false, message: 'Rating harus antara 1 dan 5' });
    return;
  }
  if (comment.trim().length < 10) {
    res.status(400).json({ success: false, message: 'Komentar minimal 10 karakter' });
    return;
  }

  const initial = nama.trim()[0]?.toUpperCase() || '?';
  const colors = ['#3F5243', '#6B4C2A', '#7A5C3C', '#4A6670', '#5E4266', '#436B5A'];
  const [count] = await query('SELECT COUNT(*) AS total FROM ulasan');
  const color = colors[Number(count.total) % colors.length];
  const result = await query(`
    INSERT INTO ulasan (nama, avatar_initial, avatar_color, category, rating, comment, reply, reply_date)
    VALUES (?, ?, ?, ?, ?, ?, '', '')
  `, [nama, initial, color, category || 'Kunjungan Umum', rating, comment.trim()]);
  const [newUlasan] = await query('SELECT * FROM ulasan WHERE id = ?', [result.insertId]);
  res.status(201).json({
    success: true,
    message: 'Ulasan berhasil dikirim. Terima kasih!',
    data: newUlasan,
  });
}));

router.post('/:id/reply', asyncHandler(async (req, res) => {
  const { reply } = req.body;
  if (!reply || reply.trim() === '') {
    res.status(400).json({ success: false, message: 'Balasan tidak boleh kosong' });
    return;
  }

  const [ulasan] = await query('SELECT * FROM ulasan WHERE id = ?', [req.params.id]);
  if (!ulasan) {
    res.status(404).json({ success: false, message: 'Ulasan tidak ditemukan' });
    return;
  }

  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const replyDate = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
  await query('UPDATE ulasan SET reply = ?, reply_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [
    reply.trim(),
    replyDate,
    req.params.id,
  ]);
  const [updated] = await query('SELECT * FROM ulasan WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Balasan berhasil dikirim', data: updated });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const [ulasan] = await query('SELECT * FROM ulasan WHERE id = ?', [req.params.id]);
  if (!ulasan) {
    res.status(404).json({ success: false, message: 'Ulasan tidak ditemukan' });
    return;
  }
  await query('DELETE FROM ulasan WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Ulasan berhasil dihapus' });
}));

module.exports = router;
