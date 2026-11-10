import 'dotenv/config';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import rateLimiter from './middleware/rateLimiter';
import authRoutes from './routes/authRoutes';
import { getJwtSecret } from './lib/jwtSecret';
import { logger, requestLogger } from './logger';
import prisma from './lib/prisma';

const app = express();
const port = Number(process.env.PORT) || 3001;

getJwtSecret();

if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGINS?.trim()) {
  throw new Error('CORS_ORIGINS wajib diatur di production ke origin frontend yang diizinkan');
}

const trustProxyHops = process.env.TRUST_PROXY_HOPS === undefined
  ? 0
  : Number(process.env.TRUST_PROXY_HOPS);
if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS harus berupa bilangan bulat non-negatif');
}
app.set('trust proxy', trustProxyHops);

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const isLocalDevelopmentOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname.endsWith('.local');
  } catch {
    return false;
  }
};

app.use(requestLogger);
app.use(helmet());
app.use(rateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: 100,
  message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
}));
app.use(cors({
  origin: (origin, callback) => {
    const isAllowedLocalOrigin = process.env.NODE_ENV !== 'production'
      && isLocalDevelopmentOrigin(origin);
    if (!origin || allowedOrigins.has(origin) || isAllowedLocalOrigin) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin tidak diizinkan: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/auth/user', authRoutes);
app.use('/api/tiket', require('./routes/tiket'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/koleksi', require('./routes/koleksi'));
app.use('/api/ulasan', require('./routes/ulasan'));
app.use('/api/informasi', require('./routes/informasi'));
app.use('/api/dashboard', require('./routes/dashboard'));

app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'Museum Brawijaya API v1.0',
    status: 'running',
    endpoints: {
      auth: '/api/auth',
      tiket: '/api/tiket',
      koleksi: '/api/koleksi',
      ulasan: '/api/ulasan',
      informasi: '/api/informasi',
      dashboard: '/api/dashboard',
    },
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} tidak ditemukan`,
  });
});

const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  logger.error({ err: error, requestId: req.id }, 'Request failed');
  res.status(500).json({
    success: false,
    message: 'Terjadi kesalahan server',
    requestId: req.id,
  });
};
app.use(errorHandler);

prisma.$connect()
  .then(() => {
    app.listen(port, () => {
      logger.info({ port }, `Museum Brawijaya Backend API berjalan di http://localhost:${port}`);
    });
  })
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'Gagal terhubung ke database melalui Prisma');
    process.exitCode = 1;
  });

export default app;
