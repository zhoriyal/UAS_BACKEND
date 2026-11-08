const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, asyncHandler } = require('../database');
const { isValidEmail, isNonEmptyString } = require('../lib/validate');
const { validatePasswordStrength } = require('../lib/validatePassword');
const { sendOtpEmail, sendPasswordResetSuccessEmail } = require('../emailService');

const JWT_SECRET = process.env.JWT_SECRET || 'museum-brawijaya-secret-2026';

exports.login = asyncHandler(async (req, res) => {
  const username = req.body.username || req.body.email;
  const password = req.body.password;
  if (!username || !password) {
    res.status(400).json({ success: false, message: 'Username / email dan password wajib diisi' });
    return;
  }

  const queryUser = username.trim().toLowerCase();
  let [account] = await query(
    'SELECT * FROM admins WHERE LOWER(username) = ? OR LOWER(username) = ?',
    [queryUser, queryUser === 'admin@museum.com' ? 'admin' : queryUser],
  );
  let role = 'ADMIN';
  if (!account) {
    [account] = await query('SELECT * FROM users WHERE LOWER(email) = ?', [queryUser]);
    role = account ? (account.role || 'USER') : 'USER';
  }

  if (!account || !(await bcrypt.compare(password, account.password_hash))) {
    res.status(401).json({ success: false, message: 'Username/email atau password salah' });
    return;
  }

  const token = jwt.sign({
    id: account.id,
    username: account.username || account.email,
    nama: account.nama,
    role,
  }, JWT_SECRET, { expiresIn: '24h' });

  res.json({
    success: true,
    message: 'Login berhasil',
    data: {
      token,
      id: account.id,
      nama: account.nama,
      username: account.username || account.email,
      email: account.email || 'admin@museum.com',
      role,
    },
  });
});

exports.register = asyncHandler(async (req, res) => {
  const { nama, email, password, role = 'STAFF' } = req.body;
  if (!isNonEmptyString(nama)) {
    res.status(400).json({ success: false, message: 'Nama lengkap wajib diisi' });
    return;
  }
  if (!isValidEmail(email)) {
    res.status(400).json({ success: false, message: 'Format email tidak valid' });
    return;
  }

  const passwordCheck = validatePasswordStrength(password);
  if (!passwordCheck.valid) {
    res.status(400).json({ success: false, message: passwordCheck.message });
    return;
  }

  const cleanEmail = email.toLowerCase().trim();
  const [[existingUser], [existingAdmin]] = await Promise.all([
    query('SELECT id FROM users WHERE LOWER(email) = ?', [cleanEmail]),
    query('SELECT id FROM admins WHERE LOWER(username) = ?', [cleanEmail]),
  ]);
  if (existingUser || existingAdmin) {
    res.status(409).json({ success: false, message: 'Email sudah terdaftar. Silakan login.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const userResult = await query(
    'INSERT INTO users (nama, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [nama.trim(), cleanEmail, passwordHash, role],
  );
  if (role === 'ADMIN' || role === 'STAFF') {
    await query('INSERT INTO admins (username, password_hash, nama, role) VALUES (?, ?, ?, ?)', [
      cleanEmail,
      passwordHash,
      nama.trim(),
      role,
    ]);
  }

  res.status(201).json({
    success: true,
    message: 'Pendaftaran berhasil. Silakan login dengan akun Anda.',
    data: { id: userResult.insertId, nama: nama.trim(), email: cleanEmail, role },
  });
});

exports.logout = (_req, res) => {
  res.json({ success: true, message: 'Logout berhasil' });
};

exports.me = (req, res) => {
  res.json({ success: true, data: req.user });
};

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email || !isValidEmail(email)) {
    res.status(400).json({ success: false, message: 'Alamat email valid wajib diisi' });
    return;
  }

  const cleanEmail = email.toLowerCase().trim();
  const [[user], [admin]] = await Promise.all([
    query('SELECT id, nama, email FROM users WHERE LOWER(email) = ?', [cleanEmail]),
    query('SELECT id, nama, username FROM admins WHERE LOWER(username) = ? OR LOWER(username) = ?', [cleanEmail, 'admin']),
  ]);
  if (!user && !admin) {
    res.status(404).json({ success: false, message: 'Email tidak ditemukan dalam sistem.' });
    return;
  }

  const targetName = user ? user.nama : admin.nama;
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  const expiredAt = new Date(Date.now() + 10 * 60 * 1000);
  await query('INSERT INTO password_resets (email, otp_code, expired_at) VALUES (?, ?, ?)', [
    cleanEmail,
    otpCode,
    expiredAt,
  ]);
  sendOtpEmail(cleanEmail, targetName, otpCode).catch((error) => console.error('[EMAIL ERROR]', error));

  res.json({
    success: true,
    message: `Kode OTP 6 digit telah dikirimkan ke email ${cleanEmail}. Berlaku 10 menit.`,
  });
});

exports.verifyOtp = asyncHandler(async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    res.status(400).json({ success: false, message: 'Email dan kode OTP wajib diisi' });
    return;
  }

  const cleanEmail = email.toLowerCase().trim();
  const [record] = await query(`
    SELECT * FROM password_resets
    WHERE LOWER(email) = ? AND otp_code = ? AND used = 0
    ORDER BY created_at DESC LIMIT 1
  `, [cleanEmail, otp.trim()]);
  if (!record) {
    res.status(400).json({ success: false, message: 'Kode OTP salah atau sudah digunakan.' });
    return;
  }
  if (new Date() > new Date(record.expired_at)) {
    res.status(400).json({ success: false, message: 'Kode OTP telah kedaluwarsa. Silakan minta kode baru.' });
    return;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  await query('UPDATE password_resets SET used = 1 WHERE id = ?', [record.id]);
  res.json({
    success: true,
    message: 'Verifikasi OTP berhasil.',
    data: { resetToken, email: cleanEmail },
  });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, newPassword } = req.body;
  if (!email || !newPassword) {
    res.status(400).json({ success: false, message: 'Email dan kata sandi baru wajib diisi' });
    return;
  }

  const passwordCheck = validatePasswordStrength(newPassword);
  if (!passwordCheck.valid) {
    res.status(400).json({ success: false, message: passwordCheck.message });
    return;
  }

  const cleanEmail = email.toLowerCase().trim();
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const adminResult = await query(
    'UPDATE admins SET password_hash = ? WHERE LOWER(username) = ? OR (LOWER(username) = ? AND ? = ?)',
    [passwordHash, cleanEmail, 'admin', cleanEmail, 'admin@museum.com'],
  );
  const userResult = await query('UPDATE users SET password_hash = ? WHERE LOWER(email) = ?', [
    passwordHash,
    cleanEmail,
  ]);
  if (adminResult.affectedRows === 0 && userResult.affectedRows === 0) {
    res.status(404).json({ success: false, message: 'Akun tidak ditemukan' });
    return;
  }

  sendPasswordResetSuccessEmail(cleanEmail, 'Pengelola Museum').catch((error) => console.error('[EMAIL ERROR]', error));
  res.json({ success: true, message: 'Kata sandi berhasil diperbarui. Silakan login kembali.' });
});
