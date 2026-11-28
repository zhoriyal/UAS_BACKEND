import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: true });
import cors from 'cors';
import express, { RequestHandler } from 'express';
import helmet from 'helmet';
import rateLimiter from './middleware/rateLimiter';
import errorHandler from './middleware/errorHandler';
import { createCorsOptions } from './middleware/corsOptions';
import authRoutes from './routes/authRoutes';
import tiketRoutes from './routes/tiket';
import koleksiRoutes from './routes/koleksi';
import ulasanRoutes from './routes/ulasan';
import informasiRoutes from './routes/informasi';
import dashboardRoutes from './routes/dashboard';
import paymentRoutes from './routes/payment';
import paymentsRoutes from './routes/payments';
import ticketsRoutes from './routes/tickets';
import aiRoutes from './routes/ai';
import storageRoutes from './routes/storage';
import notifikasiRoutes from './routes/notifikasi';
import { getJwtSecret } from './lib/jwtSecret';
import { logger, requestLogger } from './logger';
import prisma from './lib/prisma';
import { initializeDatabase } from './database';

const app = express();
const port = Number(process.env.PORT) || 3001;

getJwtSecret();

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SANDBOX_IN_PRODUCTION !== 'true') {
  if (process.env.MIDTRANS_IS_PRODUCTION !== 'true') {
    throw new Error('MIDTRANS_IS_PRODUCTION harus bernilai true di production');
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
    throw new Error('BLOB_READ_WRITE_TOKEN wajib diatur di production');
  }
  if (!process.env.MIDTRANS_SERVER_KEY || !process.env.MIDTRANS_CLIENT_KEY) {
    throw new Error('MIDTRANS_SERVER_KEY dan MIDTRANS_CLIENT_KEY wajib diatur di production');
  }
  if (process.env.MIDTRANS_SERVER_KEY.startsWith('SB-')) {
    throw new Error('MIDTRANS_SERVER_KEY production tidak boleh menggunakan key Sandbox');
  }
}

const trustProxyHops = process.env.TRUST_PROXY_HOPS === undefined
  ? 0
  : Number(process.env.TRUST_PROXY_HOPS);
if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0) {
  throw new Error('TRUST_PROXY_HOPS harus berupa bilangan bulat non-negatif');
}
app.set('trust proxy', trustProxyHops);

app.use(requestLogger);
app.use(cors(createCorsOptions()));
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(rateLimiter({
  windowMs: 15 * 60_000,
  maxRequests: process.env.NODE_ENV === 'production' ? 100 : 1000,
  message: 'Terlalu banyak permintaan. Silakan coba lagi nanti.',
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/auth/user', authRoutes);
app.use('/api/tiket', tiketRoutes);
app.use('/api/koleksi', koleksiRoutes);
app.use('/api/ulasan', ulasanRoutes);
app.use('/api/informasi', informasiRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/storage', storageRoutes);
app.use('/storage', storageRoutes);
app.use('/api/notifikasi', notifikasiRoutes);

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
      payment: '/api/payment',
      payments: '/api/payments',
      ai: '/api/ai',
    },
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
});

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route tidak ditemukan',
  });
});

app.use(errorHandler);

export const dbReady = Promise.all([
  prisma.$connect().catch((err: unknown) => {
    logger.warn({ err }, 'Prisma MySQL tidak aktif, berjalan dalam mode fallback SQLite lokal');
  }),
  initializeDatabase().catch((err: unknown) => {
    logger.warn({ err }, 'Inisialisasi tabel/seed database dilewati atau terjadi kesalahan non-fatal');
  }),
]);

if (!process.env.VERCEL) {
  dbReady
    .then(() => {
      app.listen(port, () => {
        logger.info({ port }, `Museum Brawijaya Backend API berjalan di http://localhost:${port}`);
      });
    })
    .catch((error: unknown) => {
      logger.fatal({ err: error }, 'Gagal memulai server backend');
      process.exitCode = 1;
    });
}

export default app;