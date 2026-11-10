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

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.getMe);

export default router;
