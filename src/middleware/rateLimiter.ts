import { rateLimit } from 'express-rate-limit';

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  message?: string;
}

export default function rateLimiter({
  windowMs = 60_000,
  maxRequests = 15,
  message = 'Terlalu banyak percobaan. Silakan coba lagi nanti.',
}: RateLimiterOptions = {}) {
  return rateLimit({
    windowMs,
    limit: maxRequests,
    statusCode: 429,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, message });
    },
  });
}
