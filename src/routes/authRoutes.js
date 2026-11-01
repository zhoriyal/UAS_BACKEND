const express = require('express');
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const rateLimiter = require('../middleware/rateLimiter');

const router = express.Router();

// Proteksi brute force untuk login & register (maks 20 req / menit)
const authLimiter = rateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: 'Terlalu banyak permintaan autentikasi.',
});

/**
 * Endpoint Publik
 */
router.post('/login', authLimiter, authController.login);
router.post('/register', authLimiter, authController.register);
router.post('/logout', authController.logout);
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/verify-otp', authLimiter, authController.verifyOtp);
router.post('/reset-password', authLimiter, authController.resetPassword);

/**
 * Endpoint Terproteksi Token
 */
router.get('/me', authMiddleware, authController.me);

module.exports = router;

