const express = require('express');
const db = require('../database');
const router = express.Router();

// ─── GET semua koleksi ────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const { search, kategori, status, page = 1, limit = 20 } = req.query;
  let query = 'SELECT * FROM koleksi WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (nama LIKE ? OR kode LIKE ? OR sub_deskripsi LIKE ? OR lokasi LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (kategori && kategori !== 'Semua Kategori') {
    query += ' AND kategori = ?';
    params.push(kategori);
  }
  if (status && status !== 'Semua Status') {
    query += ' AND status = ?';
    params.push(status);
  }

  const total = db.prepare(query.replace('SELECT *', 'SELECT COUNT(*) as c')).get(...params).c;
  query += ' ORDER BY id ASC LIMIT ? OFFSET ?';
  params.push(Number(limit), (Number(page) - 1) * Number(limit));

  const koleksi = db.prepare(query).all(...params);
  res.json({
    success: true,
    data: koleksi,
    pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / limit) }
  });
});

// ─── GET statistik koleksi ────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const total = db.prepare("SELECT COUNT(*) as c FROM koleksi").get().c;
  const dipamerkan = db.prepare("SELECT COUNT(*) as c FROM koleksi WHERE status = 'DIPAMERKAN'").get().c;
  const restorasi = db.prepare("SELECT COUNT(*) as c FROM koleksi WHERE status = 'RESTORASI'").get().c;
  const disimpan = db.prepare("SELECT COUNT(*) as c FROM koleksi WHERE status = 'SIMPAN'").get().c;
  res.json({ success: true, data: { total, dipamerkan, restorasi, disimpan } });
});

// ─── GET satu koleksi ─────────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM koleksi WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Koleksi tidak ditemukan' });
  res.json({ success: true, data: item });
});

// ─── POST tambah koleksi (admin) ──────────────────────────────────────────────
router.post('/', (req, res) => {
  const { nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url } = req.body;
  if (!nama || !kategori) {
    return res.status(400).json({ success: false, message: 'Nama dan kategori wajib diisi' });
  }

  // Generate kode inventaris otomatis
  const last = db.prepare("SELECT kode FROM koleksi ORDER BY id DESC LIMIT 1").get();
  let nextNum = 1;
  if (last) {
    const match = last.kode.match(/(\d+)$/);
    if (match) nextNum = parseInt(match[1]) + 1;
  }
  const kode = `#INV-MB-${String(nextNum).padStart(3, '0')}`;

  const result = db.prepare(`
    INSERT INTO koleksi (kode, nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(kode, nama, sub_deskripsi || '', deskripsi_lengkap || '', kategori,
         tahun || '', lokasi || '', status || 'DIPAMERKAN', image_url || null);

  const newItem = db.prepare('SELECT * FROM koleksi WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ success: true, message: 'Koleksi berhasil ditambahkan', data: newItem });
});

// ─── PUT edit koleksi (admin) ─────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM koleksi WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Koleksi tidak ditemukan' });

  const { nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url } = req.body;
  db.prepare(`
    UPDATE koleksi SET
      nama = ?, sub_deskripsi = ?, deskripsi_lengkap = ?, kategori = ?,
      tahun = ?, lokasi = ?, status = ?, image_url = ?,
      updated_at = datetime('now','localtime')
    WHERE id = ?
  `).run(
    nama || existing.nama,
    sub_deskripsi ?? existing.sub_deskripsi,
    deskripsi_lengkap ?? existing.deskripsi_lengkap,
    kategori || existing.kategori,
    tahun ?? existing.tahun,
    lokasi ?? existing.lokasi,
    status || existing.status,
    image_url ?? existing.image_url,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM koleksi WHERE id = ?').get(req.params.id);
  res.json({ success: true, message: 'Koleksi berhasil diperbarui', data: updated });
});

// ─── DELETE koleksi (admin) ───────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM koleksi WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, message: 'Koleksi tidak ditemukan' });
  db.prepare('DELETE FROM koleksi WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Koleksi berhasil dihapus' });
});

module.exports = router;
