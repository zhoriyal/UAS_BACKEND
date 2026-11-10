const express = require('express');
const { query, asyncHandler } = require('../database');
const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { status } = req.query;
  const items = status && status !== 'Semua'
    ? await query('SELECT * FROM pengumuman WHERE status = ? ORDER BY id DESC', [status])
    : await query('SELECT * FROM pengumuman ORDER BY id DESC');
  res.json({ success: true, data: items });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { title, description, category, date, status } = req.body;
  if (!title || !category || !date) {
    res.status(400).json({ success: false, message: 'Judul, kategori, dan tanggal wajib diisi' });
    return;
  }
  const result = await query(`
    INSERT INTO pengumuman (title, description, category, date, status)
    VALUES (?, ?, ?, ?, ?)
  `, [title, description || '', category, date, status || 'AKTIF']);
  const [newItem] = await query('SELECT * FROM pengumuman WHERE id = ?', [result.insertId]);
  res.status(201).json({ success: true, message: 'Pengumuman berhasil ditambahkan', data: newItem });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const [existing] = await query('SELECT * FROM pengumuman WHERE id = ?', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan' });
    return;
  }
  const { title, description, category, date, status } = req.body;
  await query(`
    UPDATE pengumuman
    SET title = ?, description = ?, category = ?, date = ?, status = ?
    WHERE id = ?
  `, [
    title || existing.title,
    description ?? existing.description,
    category || existing.category,
    date || existing.date,
    status || existing.status,
    req.params.id,
  ]);
  const [updated] = await query('SELECT * FROM pengumuman WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Pengumuman berhasil diperbarui', data: updated });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const [existing] = await query('SELECT * FROM pengumuman WHERE id = ?', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan' });
    return;
  }
  await query('DELETE FROM pengumuman WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Pengumuman berhasil dihapus' });
}));

router.get('/faq', asyncHandler(async (_req, res) => {
  const items = await query('SELECT * FROM faq ORDER BY id ASC');
  res.json({ success: true, data: items });
}));

router.post('/faq', asyncHandler(async (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer) {
    res.status(400).json({ success: false, message: 'Pertanyaan dan jawaban wajib diisi' });
    return;
  }
  const result = await query('INSERT INTO faq (question, answer) VALUES (?, ?)', [question, answer]);
  const [newFaq] = await query('SELECT * FROM faq WHERE id = ?', [result.insertId]);
  res.status(201).json({ success: true, message: 'FAQ berhasil ditambahkan', data: newFaq });
}));

router.put('/faq/:id', asyncHandler(async (req, res) => {
  const [existing] = await query('SELECT * FROM faq WHERE id = ?', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'FAQ tidak ditemukan' });
    return;
  }
  const { question, answer } = req.body;
  await query('UPDATE faq SET question = ?, answer = ? WHERE id = ?', [
    question || existing.question,
    answer || existing.answer,
    req.params.id,
  ]);
  const [updated] = await query('SELECT * FROM faq WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'FAQ berhasil diperbarui', data: updated });
}));

router.delete('/faq/:id', asyncHandler(async (req, res) => {
  const [existing] = await query('SELECT * FROM faq WHERE id = ?', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'FAQ tidak ditemukan' });
    return;
  }
  await query('DELETE FROM faq WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'FAQ berhasil dihapus' });
}));

router.get('/jam-operasional', asyncHandler(async (_req, res) => {
  const [hours] = await query('SELECT * FROM jam_operasional ORDER BY id DESC LIMIT 1');
  res.json({
    success: true,
    data: hours || { hari: 'Selasa - Minggu', jam: '08:00 - 15:00 WIB', telepon: '(0341) 551502' },
  });
}));

router.put('/jam-operasional', asyncHandler(async (req, res) => {
  const { hari, jam, telepon } = req.body;
  const [existing] = await query('SELECT * FROM jam_operasional ORDER BY id DESC LIMIT 1');
  if (existing) {
    await query(`
      UPDATE jam_operasional
      SET hari = ?, jam = ?, telepon = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [hari || existing.hari, jam || existing.jam, telepon || existing.telepon, existing.id]);
  } else {
    await query('INSERT INTO jam_operasional (hari, jam, telepon) VALUES (?, ?, ?)', [hari, jam, telepon]);
  }
  const [updated] = await query('SELECT * FROM jam_operasional ORDER BY id DESC LIMIT 1');
  res.json({ success: true, message: 'Jam operasional berhasil diperbarui', data: updated });
}));

module.exports = router;
