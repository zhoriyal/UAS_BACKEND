const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database');
const { isValidEmail, isNonEmptyString } = require('../lib/validate');
const { validatePasswordStrength } = require('../lib/validatePassword');
const { sendOtpEmail, sendPasswordResetSuccessEmail } = require('../emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'museum-brawijaya-secret-2026';

/**
 * POST /login
 */
exports.login = (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username / email dan password wajib diisi' });
  }

  const queryUser = username.trim().toLowerCase();

  // 1. Cek tabel admins terlebih dahulu
  let account = db.prepare('SELECT * FROM admins WHERE LOWER(username) = ? OR LOWER(username) = ?').get(
    queryUser,
    queryUser === 'admin@museum.com' ? 'admin' : queryUser
  );
  let role = 'ADMIN';

  // 2. Jika bukan admin, cek tabel users
  if (!account) {
    account = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(queryUser);
    role = account ? (account.role || 'USER') : 'USER';
  }

  if (!account) {
    return res.status(401).json({ success: false, message: 'Username/email atau password salah' });
  }

  const valid = bcrypt.compareSync(password, account.password_hash);
  if (!valid) {
    return res.status(401).json({ success: false, message: 'Username/email atau password salah' });
  }

  const token = jwt.sign(
    {
      id: account.id,
      username: account.username || account.email,
      nama: account.nama,
      role: role,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({
    success: true,
    message: 'Login berhasil',
    data: {
      token,
      nama: account.nama,
      username: account.username || account.email,
      email: account.email || 'admin@museum.com',
      role,
    },
  });
};

/**
 * POST /register
 */
exports.register = (req, res) => {
  const { nama, email, password, role = 'STAFF' } = req.body;

  if (!isNonEmptyString(nama)) {
    return res.status(400).json({ success: false, message: 'Nama lengkap wajib diisi' });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Format email tidak valid' });
  }

  const passCheck = validatePasswordStrength(password);
  if (!passCheck.valid) {
    return res.status(400).json({ success: false, message: passCheck.message });
  }

  const cleanEmail = email.toLowerCase().trim();

  // Cek apakah sudah terdaftar di users atau admins
  const existUser = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(cleanEmail);
  const existAdmin = db.prepare('SELECT id FROM admins WHERE LOWER(username) = ?').get(cleanEmail);

  if (existUser || existAdmin) {
    return res.status(409).json({ success: false, message: 'Email sudah terdaftar. Silakan login.' });
  }

  const hash = bcrypt.hashSync(password, 10);

  // Jika didaftarkan sebagai STAFF atau ADMIN, masukkan juga ke tabel admins agar dapat akses panel
  if (role === 'ADMIN' || role === 'STAFF') {
    db.prepare('INSERT INTO admins (username, password_hash, nama) VALUES (?, ?, ?)').run(cleanEmail, hash, nama.trim());
  }

  const info = db.prepare(
    'INSERT INTO users (nama, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(nama.trim(), cleanEmail, hash, role);

  res.status(201).json({
    success: true,
    message: 'Pendaftaran berhasil. Silakan login dengan akun Anda.',
    data: {
      id: info.lastInsertRowid,
      nama: nama.trim(),
      email: cleanEmail,
      role,
    },
  });
};

/**
 * POST /logout
 */
exports.logout = (req, res) => {
  res.json({ success: true, message: 'Logout berhasil' });
};

/**
 * GET /me (Memeriksa sesi pengguna aktif)
 */
exports.me = (req, res) => {
  res.json({
    success: true,
    data: req.user,
  });
};

/**
 * POST /forgot-password
 */
exports.forgotPassword = (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ success: false, message: 'Alamat email valid wajib diisi' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const user = db.prepare('SELECT id, nama, email FROM users WHERE LOWER(email) = ?').get(cleanEmail);
  const admin = db.prepare('SELECT id, nama, username FROM admins WHERE LOWER(username) = ? OR LOWER(username) = ?').get(cleanEmail, 'admin');

  if (!user && !admin) {
    return res.status(404).json({ success: false, message: 'Email tidak ditemukan dalam sistem.' });
  }

  const targetName = user ? user.nama : admin.nama;
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiredAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare(`
    INSERT INTO password_resets (email, otp_code, expired_at)
    VALUES (?, ?, ?)
  `).run(cleanEmail, otpCode, expiredAt);

  sendOtpEmail(cleanEmail, targetName, otpCode).catch((err) => console.error('[EMAIL ERROR]', err));

  res.json({
    success: true,
    message: `Kode OTP 6 digit telah dikirimkan ke email ${cleanEmail}. Berlaku 10 menit.`,
  });
};

/**
 * POST /verify-otp
 */
exports.verifyOtp = (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email dan kode OTP wajib diisi' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const record = db.prepare(`
    SELECT * FROM password_resets 
    WHERE LOWER(email) = ? AND otp_code = ? AND used = 0
    ORDER BY created_at DESC LIMIT 1
  `).get(cleanEmail, otp.trim());

  if (!record) {
    return res.status(400).json({ success: false, message: 'Kode OTP salah atau sudah digunakan.' });
  }

  if (new Date() > new Date(record.expired_at)) {
    return res.status(400).json({ success: false, message: 'Kode OTP telah kedaluwarsa. Silakan minta kode baru.' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(record.id);

  res.json({
    success: true,
    message: 'Verifikasi OTP berhasil.',
    data: { resetToken, email: cleanEmail },
  });
};

/**
 * POST /reset-password
 */
exports.resetPassword = (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    return res.status(400).json({ success: false, message: 'Email dan kata sandi baru wajib diisi' });
  }

  const passCheck = validatePasswordStrength(newPassword);
  if (!passCheck.valid) {
    return res.status(400).json({ success: false, message: passCheck.message });
  }

  const cleanEmail = email.toLowerCase().trim();
  const newHash = bcrypt.hashSync(newPassword, 10);

  const updateAdmin = db.prepare('UPDATE admins SET password_hash = ? WHERE LOWER(username) = ? OR (LOWER(username) = ? AND ? = ?)')
    .run(newHash, cleanEmail, 'admin', cleanEmail, 'admin@museum.com');

  const updateUser = db.prepare('UPDATE users SET password_hash = ? WHERE LOWER(email) = ?')
    .run(newHash, cleanEmail);

  if (updateAdmin.changes === 0 && updateUser.changes === 0) {
    return res.status(404).json({ success: false, message: 'Akun tidak ditemukan' });
  }

  sendPasswordResetSuccessEmail(cleanEmail, 'Pengelola Museum').catch((err) => console.error('[EMAIL ERROR]', err));

  res.json({
    success: true,
    message: 'Kata sandi berhasil diperbarui. Silakan login kembali.',
  });
};

