require('dotenv/config');
const express = require('express');
const cors = require('cors');
const { initializeDatabase } = require('./database');

const authRoutes      = require('./routes/auth');
const tiketRoutes     = require('./routes/tiket');
const koleksiRoutes   = require('./routes/koleksi');
const ulasanRoutes    = require('./routes/ulasan');
const informasiRoutes = require('./routes/informasi');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Mengizinkan semua origin dari localhost (Flutter web random port, Next.js, emulator)
    callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// ─── REQUEST LOGGER ──────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  const time = new Date().toLocaleTimeString('id-ID');
  console.log(`[${time}] ${req.method} ${req.originalUrl}`);
  next();
});

// ─── ROUTES ──────────────────────────────────────────────────────────────────
app.use('/api/auth',        authRoutes);
app.use('/api/auth/user',   authRoutes); // <--- TAMBAHAN INI SUPAYA /api/auth/user/login VALID
app.use('/api/tiket',      tiketRoutes);
app.use('/api/koleksi',    koleksiRoutes);
app.use('/api/ulasan',     ulasanRoutes);
app.use('/api/informasi',  informasiRoutes);
app.use('/api/dashboard',  dashboardRoutes);

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    success: true,
    message: '🏛️ Museum Brawijaya API v1.0',
    status: 'running',
    endpoints: {
      auth:       '/api/auth',
      tiket:      '/api/tiket',
      koleksi:    '/api/koleksi',
      ulasan:     '/api/ulasan',
      informasi:  '/api/informasi',
      dashboard:  '/api/dashboard',
    }
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
});

// ─── 404 HANDLER ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} tidak ditemukan` });
});

// ─── ERROR HANDLER ────────────────────────────────────────────────------------
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ success: false, message: 'Terjadi kesalahan server', error: err.message });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
initializeDatabase()
  .then(() => {
    app.listen(PORT, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════════════╗');
      console.log('║        Museum Brawijaya Backend API               ║');
      console.log('╠══════════════════════════════════════════════════╣');
      console.log(`║  Server berjalan di: http://localhost:${PORT}        ║`);
      console.log('║  Database: MySQL                                  ║');
      console.log('║                                                  ║');
      console.log('║  Endpoints tersedia:                             ║');
      console.log(`║  • POST /api/auth/login / user/login             ║`);
      console.log(`║  • GET  /api/tiket/categories                    ║`);
      console.log(`║  • POST /api/tiket/bookings                      ║`);
      console.log(`║  • GET  /api/koleksi                             ║`);
      console.log(`║  • GET  /api/ulasan                              ║`);
      console.log(`║  • POST /api/ulasan                              ║`);
      console.log(`║  • POST /api/ulasan/:id/reply                    ║`);
      console.log(`║  • GET  /api/dashboard/summary                   ║`);
      console.log('╚══════════════════════════════════════════════════╝');
      console.log('');
    });
  })
  .catch((error) => {
    console.error('Gagal menginisialisasi database MySQL:', error);
    process.exitCode = 1;
  });

module.exports = app;