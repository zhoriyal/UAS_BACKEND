import { Router } from 'express';
import { chatWithAssistant, generateDescription, getChatSuggestions } from '../controllers/aiController';
import { asyncHandler } from '../database';
import authMiddleware from '../middleware/authMiddleware';
import requireRole from '../middleware/requireRole';
import rateLimiter from '../middleware/rateLimiter';

const router = Router();
const aiChatRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 60,
  message: 'Terlalu banyak pesan ke Asisten AI. Silakan coba lagi beberapa menit lagi.',
});

router.get('/chat/suggestions', getChatSuggestions);
router.post('/chat', aiChatRateLimit, asyncHandler(chatWithAssistant));
router.post(
  '/generate-description',
  authMiddleware,
  requireRole(['ADMIN', 'SUPERADMIN', 'STAFF']),
  asyncHandler(generateDescription),
);

export default router;
