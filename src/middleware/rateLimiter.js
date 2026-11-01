/**
 * In-memory rate limiter sederhana untuk endpoint kritis (login, register)
 */
const rateLimitMap = new Map();

function rateLimiter({ windowMs = 60 * 1000, maxRequests = 15, message = 'Terlalu banyak percobaan. Silakan coba lagi nanti.' } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();

    const record = rateLimitMap.get(ip);
    if (!record || now > record.resetTime) {
      rateLimitMap.set(ip, { count: 1, resetTime: now + windowMs });
      return next();
    }

    record.count++;
    if (record.count > maxRequests) {
      const waitSec = Math.ceil((record.resetTime - now) / 1000);
      return res.status(429).json({
        success: false,
        message: `${message} Coba lagi dalam ${waitSec} detik.`,
      });
    }

    next();
  };
}

module.exports = rateLimiter;

