const express = require('express');
const router = express.Router();

// Mengambil fungsi dari authController yang ada di folder controllers
const authController = require('../controllers/authController');

// ─── DEFINISI ENDPOINT AUTH ──────────────────────────────────────────────────
// Mendukung berbagai macam variasi URL login yang mungkin dipanggil oleh frontend/Flutter
router.post('/login', authController.login || ((req, res) => {
  res.status(501).json({ success: false, message: 'Controller login belum diimplementasikan di authController.js' });
}));

router.post('/user/login', authController.login || authController.userLogin || ((req, res) => {
  res.status(501).json({ success: false, message: 'Controller login belum diimplementasikan' });
}));

router.post('/register', authController.register || ((req, res) => {
  res.status(501).json({ success: false, message: 'Controller register belum diimplementasikan' });
}));

router.post('/user/register', authController.register || ((req, res) => {
  res.status(501).json({ success: false, message: 'Controller register belum diimplementasikan' });
}));

module.exports = router;