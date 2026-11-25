import { Router } from 'express';
import * as authController from '../controllers/authController';
import authMiddleware from '../middleware/authMiddleware';
import rateLimiter from '../middleware/rateLimiter';

const router = Router();
const authLimiter = rateLimiter({
  windowMs: 60_000,
  maxRequests: 20,
  message: 'Terlalu banyak permintaan autentikasi. Coba lagi nanti.',
});
const loginLimiter = rateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: 10,
  message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
});

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, loginLimiter, authController.login);
router.get('/google/config', authController.getGoogleAuthConfig);
router.post('/google', authLimiter, authController.googleLogin);
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/verify-reset-otp', authLimiter, authController.verifyResetOtp);
router.post('/reset-password', authLimiter, authController.resetPassword);
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.getMe);
router.put('/profile', authMiddleware, authController.updateProfile);
router.put('/user/profile', authMiddleware, authController.updateProfile);
router.put('/change-password', authMiddleware, authController.changePassword);
router.put('/user/change-password', authMiddleware, authController.changePassword);

export default router;
