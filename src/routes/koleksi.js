const express = require('express');
const { query, asyncHandler } = require('../database');
const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { search, kategori, status, page = 1, limit = 20 } = req.query;
  let where = ' FROM koleksi WHERE 1=1';
  const params = [];

  if (search) {
    where += ' AND (nama LIKE ? OR kode LIKE ? OR sub_deskripsi LIKE ? OR lokasi LIKE ?)';
    const value = `%${search}%`;
    params.push(value, value, value, value);
  }
  if (kategori && kategori !== 'Semua Kategori') {
    where += ' AND kategori = ?';
    params.push(kategori);
  }
  if (status && status !== 'Semua Status') {
    where += ' AND status = ?';
    params.push(status);
  }

  const [{ total }] = await query(`SELECT COUNT(*) AS total${where}`, params);
  const pageNumber = Number(page);
  const pageSize = Number(limit);
  const data = await query(
    `SELECT *${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, pageSize, (pageNumber - 1) * pageSize],
  );
  res.json({
    success: true,
    data,
    pagination: { total, page: pageNumber, limit: pageSize, totalPages: Math.ceil(total / pageSize) },
  });
}));

router.get('/stats', asyncHandler(async (_req, res) => {
  const [stats] = await query(`
    SELECT COUNT(*) AS total,
      SUM(status = 'DIPAMERKAN') AS dipamerkan,
      SUM(status = 'RESTORASI') AS restorasi,
      SUM(status = 'SIMPAN') AS disimpan
    FROM koleksi
  `);
  res.json({
    success: true,
    data: {
      total: Number(stats.total),
      dipamerkan: Number(stats.dipamerkan || 0),
      restorasi: Number(stats.restorasi || 0),
      disimpan: Number(stats.disimpan || 0),
    },
  });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const [item] = await query('SELECT * FROM koleksi WHERE id = ?', [req.params.id]);
  if (!item) {
    res.status(404).json({ success: false, message: 'Koleksi tidak ditemukan' });
    return;
  }
  res.json({ success: true, data: item });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url } = req.body;
  if (!nama || !kategori) {
    res.status(400).json({ success: false, message: 'Nama dan kategori wajib diisi' });
    return;
  }

  const [last] = await query('SELECT kode FROM koleksi ORDER BY id DESC LIMIT 1');
  const match = last?.kode.match(/(\d+)$/);
  const nextNum = match ? Number.parseInt(match[1], 10) + 1 : 1;
  const kode = `#INV-MB-${String(nextNum).padStart(3, '0')}`;
  const result = await query(`
    INSERT INTO koleksi (kode, nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    kode,
    nama,
    sub_deskripsi || '',
    deskripsi_lengkap || '',
    kategori,
    tahun || '',
    lokasi || '',
    status || 'DIPAMERKAN',
    image_url || null,
  ]);
  const [newItem] = await query('SELECT * FROM koleksi WHERE id = ?', [result.insertId]);
  res.status(201).json({ success: true, message: 'Koleksi berhasil ditambahkan', data: newItem });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const [existing] = await query('SELECT * FROM koleksi WHERE id = ?', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Koleksi tidak ditemukan' });
    return;
  }

  const { nama, sub_deskripsi, deskripsi_lengkap, kategori, tahun, lokasi, status, image_url } = req.body;
  await query(`
    UPDATE koleksi SET
      nama = ?, sub_deskripsi = ?, deskripsi_lengkap = ?, kategori = ?,
      tahun = ?, lokasi = ?, status = ?, image_url = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [
    nama || existing.nama,
    sub_deskripsi ?? existing.sub_deskripsi,
    deskripsi_lengkap ?? existing.deskripsi_lengkap,
    kategori || existing.kategori,
    tahun ?? existing.tahun,
    lokasi ?? existing.lokasi,
    status || existing.status,
    image_url ?? existing.image_url,
    req.params.id,
  ]);

  const [updated] = await query('SELECT * FROM koleksi WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Koleksi berhasil diperbarui', data: updated });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const [existing] = await query('SELECT * FROM koleksi WHERE id = ?', [req.params.id]);
  if (!existing) {
    res.status(404).json({ success: false, message: 'Koleksi tidak ditemukan' });
    return;
  }
  await query('DELETE FROM koleksi WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Koleksi berhasil dihapus' });
}));

module.exports = router;
