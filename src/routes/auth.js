const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'museum-brawijaya-secret-2026';

/**
 * POST /api/auth/login
 * Body: { username, password }
 */
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username dan password wajib diisi' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ? OR username = ?').get(
    username,
    username === 'admin@museum.com' ? 'admin' : username
  );
  if (!admin) {
    return res.status(401).json({ success: false, message: 'Username atau password salah' });
  }

  const valid = bcrypt.compareSync(password, admin.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Username atau password salah' });
  }

  const token = jwt.sign(
    { id: admin.id, username: admin.username, nama: admin.nama },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    success: true,
    message: 'Login berhasil',
    data: { token, nama: admin.nama, username: admin.username }
  });
});

/**
 * POST /api/auth/logout  (client-side: hapus token saja)
 */
router.post('/logout', (req, res) => {
  res.json({ success: true, message: 'Logout berhasil' });
});

/**
 * GET /api/auth/me  — verifikasi token
 */
router.get('/me', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Token tidak ditemukan' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ success: true, data: decoded });
  } catch {
    res.status(401).json({ success: false, message: 'Token tidak valid' });
  }
});

module.exports = router;
