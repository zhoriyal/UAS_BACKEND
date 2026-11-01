const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'museum-brawijaya-secret-2026';

/**
 * Middleware untuk memverifikasi JWT Bearer Token
 * Menyimpan data payload terverifikasi pada req.user
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: 'Akses ditolak: Token autentikasi tidak ditemukan.',
    });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({
      success: false,
      message: 'Format token tidak valid (harus Bearer <token>).',
    });
  }

  const token = parts[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded; // { id, username, nama, role }
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Sesi kedaluwarsa atau token tidak valid. Silakan login kembali.',
    });
  }
}

module.exports = authMiddleware;

