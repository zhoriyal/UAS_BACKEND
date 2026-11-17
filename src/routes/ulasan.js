const express = require('express');
const { query, asyncHandler } = require('../database');
const router = express.Router();
const authMiddlewareModule = require('../middleware/authMiddleware');
const authMiddleware = authMiddlewareModule.default || authMiddlewareModule;
const requireRoleModule = require('../middleware/requireRole');
const requireRole = requireRoleModule.requireRole || requireRoleModule.default || requireRoleModule;

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
  const { nama, avatar_initial, avatar_color, rating, comment, category } = req.body;
  const reviewName = typeof nama === 'string' && nama.trim() ? nama.trim() : 'Pengunjung';
  if (!Number.isInteger(Number(rating)) || !comment) {
    res.status(400).json({ success: false, message: 'Rating dan komentar wajib diisi' });
    return;
  }
  const reviewRating = Number(rating);
  if (reviewRating < 1 || reviewRating > 5) {
    res.status(400).json({ success: false, message: 'Rating harus antara 1 dan 5' });
    return;
  }
  if (typeof comment !== 'string' || comment.trim().length < 10) {
    res.status(400).json({ success: false, message: 'Komentar minimal 10 karakter' });
    return;
  }

  const result = await query(`
    INSERT INTO ulasan (nama, avatar_initial, avatar_color, category, rating, comment, reply, reply_date, created_at)
    VALUES (?, ?, ?, ?, ?, ?, '', '', NOW())
  `, [
    reviewName,
    avatar_initial || 'P',
    avatar_color || '#2C4A2C',
    category || 'Umum',
    reviewRating,
    comment.trim(),
  ]);
  const [newUlasan] = await query('SELECT * FROM ulasan WHERE id = ?', [result.insertId]);
  res.status(201).json({
    success: true,
    message: 'Ulasan berhasil dikirim. Terima kasih!',
    data: newUlasan,
  });
}));

const saveReply = asyncHandler(async (req, res) => {
  const reply = req.body?.reply;
  if (typeof reply !== 'string' || reply.trim() === '') {
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
});

router.post('/:id/reply', authMiddleware, requireRole(['ADMIN', 'SUPERADMIN', 'STAFF']), saveReply);
router.put('/:id/reply', authMiddleware, requireRole(['ADMIN', 'SUPERADMIN', 'STAFF']), saveReply);

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
