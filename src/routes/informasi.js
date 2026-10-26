const express = require('express');
const db = require('../database');
const router = express.Router();

// ─── GET semua pengumuman ─────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM pengumuman WHERE 1=1';
  const params = [];
  if (status && status !== 'Semua') {
    query += ' AND status = ?';
    params.push(status);
  }
  query += ' ORDER BY id DESC';
  const items = db.prepare(query).all(...params);
  res.json({ success: true, data: items });
});

// ─── POST tambah pengumuman (admin) ───────────────────────────────────────────
router.post('/', (req, res) => {
  const { title, description, category, date, status } = req.body;
  if (!title || !category || !date) {
    return res.status(400).json({ success: false, message: 'Judul, kategori, dan tanggal wajib diisi' });
  }
  const result = db.prepare(`
    INSERT INTO pengumuman (title, description, category, date, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(title, description || '', category, date, status || 'AKTIF');
  const newItem = db.prepare('SELECT * FROM pengumuman WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'Pengumuman berhasil ditambahkan', data: newItem });
});

// ─── PUT edit pengumuman (admin) ──────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM pengumuman WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan' });
  const { title, description, category, date, status } = req.body;
  db.prepare(`
    UPDATE pengumuman SET title = ?, description = ?, category = ?, date = ?, status = ? WHERE id = ?
  `).run(
    title || existing.title,
    description ?? existing.description,
    category || existing.category,
    date || existing.date,
    status || existing.status,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM pengumuman WHERE id = ?').get(req.params.id);
  res.json({ success: true, message: 'Pengumuman berhasil diperbarui', data: updated });
});

// ─── DELETE pengumuman (admin) ────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM pengumuman WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Pengumuman tidak ditemukan' });
  db.prepare('DELETE FROM pengumuman WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Pengumuman berhasil dihapus' });
});

// ─── GET semua FAQ ────────────────────────────────────────────────────────────
router.get('/faq', (req, res) => {
  const items = db.prepare('SELECT * FROM faq ORDER BY id ASC').all();
  res.json({ success: true, data: items });
});

// ─── POST tambah FAQ (admin) ──────────────────────────────────────────────────
router.post('/faq', (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer) {
    return res.status(400).json({ success: false, message: 'Pertanyaan dan jawaban wajib diisi' });
  }
  const result = db.prepare('INSERT INTO faq (question, answer) VALUES (?, ?)').run(question, answer);
  const newFaq = db.prepare('SELECT * FROM faq WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'FAQ berhasil ditambahkan', data: newFaq });
});

// ─── PUT edit FAQ (admin) ─────────────────────────────────────────────────────
router.put('/faq/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM faq WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'FAQ tidak ditemukan' });
  const { question, answer } = req.body;
  db.prepare('UPDATE faq SET question = ?, answer = ? WHERE id = ?').run(
    question || existing.question,
    answer || existing.answer,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM faq WHERE id = ?').get(req.params.id);
  res.json({ success: true, message: 'FAQ berhasil diperbarui', data: updated });
});

// ─── DELETE FAQ (admin) ───────────────────────────────────────────────────────
router.delete('/faq/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM faq WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'FAQ tidak ditemukan' });
  db.prepare('DELETE FROM faq WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'FAQ berhasil dihapus' });
});

// ─── GET jam operasional ──────────────────────────────────────────────────────
router.get('/jam-operasional', (req, res) => {
  const jam = db.prepare('SELECT * FROM jam_operasional ORDER BY id DESC LIMIT 1').get();
  res.json({ success: true, data: jam || { hari: 'Selasa - Minggu', jam: '08:00 - 15:00 WIB', telepon: '(0341) 551502' } });
});

// ─── PUT update jam operasional (admin) ───────────────────────────────────────
router.put('/jam-operasional', (req, res) => {
  const { hari, jam, telepon } = req.body;
  const existing = db.prepare('SELECT * FROM jam_operasional ORDER BY id DESC LIMIT 1').get();
  if (existing) {
    db.prepare(`UPDATE jam_operasional SET hari = ?, jam = ?, telepon = ?, updated_at = datetime('now','localtime') WHERE id = ?`)
      .run(hari || existing.hari, jam || existing.jam, telepon || existing.telepon, existing.id);
  } else {
    db.prepare('INSERT INTO jam_operasional (hari, jam, telepon) VALUES (?, ?, ?)').run(hari, jam, telepon);
  }
  const updated = db.prepare('SELECT * FROM jam_operasional ORDER BY id DESC LIMIT 1').get();
  res.json({ success: true, message: 'Jam operasional berhasil diperbarui', data: updated });
});

module.exports = router;
