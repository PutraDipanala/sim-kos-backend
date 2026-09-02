// backend/src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { apiLimiter } = require('./middleware/rateLimiter');

const app = express();
const PORT = process.env.PORT || 5000;

// ===== Trust Proxy (wajib untuk ngrok / Nginx / reverse proxy) =====
// Mencegah error express-rate-limit saat ada header X-Forwarded-For
app.set('trust proxy', 1);

// ===== Security Middleware (HARUS DI ATAS!) =====
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // Untuk serve images
}));

// ===== CORS Configuration =====
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin.endsWith('.vercel.app') || origin.startsWith('http://localhost')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-role-mode', 'role-mode'],
}));

// ===== Body Parser Middleware =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// ===== Setup Express Session =====
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 hari
    sameSite: 'lax'
  }
}));

// ===== Rate Limiting (API Protection) =====
app.use('/api/', apiLimiter);

// ===== Serve Static Files (untuk foto kos) =====
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ===== Import Routes =====
const kosRoutes = require('./routes/kos.routes');
const authRoutes = require('./routes/auth.routes');
const fasilitasRoutes = require('./routes/fasilitas.routes');
const profileRoutes = require('./routes/profile.routes');         // ✅ TAMBAH INI
const adminBanjarRoutes = require('./routes/adminBanjar.routes'); // ✅ TAMBAH INI (kalau ada)
const lokasiAdatRoutes = require('./routes/lokasiAdat.routes');   // ✅ TAMBAH INI (kalau ada)
const sewaRoutes    = require('./routes/sewa.routes');
const paymentRoutes = require('./routes/payment.routes');  // ✅ Midtrans Webhook
const iuranRoutes   = require('./routes/iuran.routes');   // ✅ Manajemen Iuran Desa
const billingRoutes = require('./routes/billing.routes');   // ✅ Sistem Billing Otomatis
const kamarRoutes   = require('./routes/kamar.routes');     // ✅ CRUD Kamar Kos
const withdrawRoutes = require('./routes/withdraw.routes');  // ✅ TAMBAH: Withdraw Saldo Pemilik Kos
const adminRoutes = require('./routes/admin.routes');        // ✅ TAMBAH: Monitoring & Admin khusus
const aduanRoutes = require('./routes/aduan.routes');        // ✅ TAMBAH: Pusat Aspirasi
const laporanRoutes = require('./routes/laporan.routes');    // ✅ TAMBAH: Pusat Laporan
const wilayahRoutes = require('./routes/wilayah.routes');


// ===== Register Routes =====
app.use('/api/kos', kosRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/fasilitas', fasilitasRoutes);
app.use('/api/profile', profileRoutes);                     // ✅ TAMBAH INI
app.use('/api/admin/banjar', adminBanjarRoutes);            // ✅ TAMBAH INI (kalau ada)
app.use('/api/lokasi-adat', lokasiAdatRoutes);              // ✅ TAMBAH INI (kalau ada)
app.use('/api/sewa', sewaRoutes);
app.use('/api/payment', paymentRoutes);             // ✅ Midtrans Webhook Notification
app.use('/api/iuran', iuranRoutes);                 // ✅ Manajemen Iuran Desa
app.use('/api/billing', billingRoutes);             // ✅ Sistem Billing Otomatis
app.use('/api/kamar-kos', kamarRoutes);             // ✅ CRUD Kamar Kos
app.use('/api/withdraw', withdrawRoutes);             // ✅ Withdraw Saldo Pemilik Kos
app.use('/api/admin', adminRoutes);                   // ✅ TAMBAH: Monitoring & Admin khusus
app.use('/api/aduan', aduanRoutes);                   // ✅ TAMBAH: Pusat Aspirasi
app.use('/api/laporan', laporanRoutes);               // ✅ TAMBAH: Pusat Laporan
app.use('/api/wilayah', wilayahRoutes);


// ===== Setup Cron Scheduler =====
require('./config/cron');

// ===== Health Check Route =====
app.get('/', (req, res) => {
  res.json({ 
    message: 'SIM Kos Desa Adat API',
    version: '2.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// ===== 404 Handler =====
app.use((req, res, next) => {
  res.status(404).json({ message: 'Endpoint tidak ditemukan' });
});

// ===== Error Handler =====
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);

  const errorMessage = process.env.NODE_ENV === 'production' 
    ? 'Terjadi kesalahan server' 
    : err.message;

  res.status(err.status || 500).json({ 
    message: errorMessage,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════╗
║   🚀 SIM Kos Desa Adat API Server              ║
╠════════════════════════════════════════════════╣
║   📡 URL: http://localhost:${PORT}              ║
║   🌍 Environment: ${process.env.NODE_ENV || 'development'}           ║
║   🔒 JWT Auth: Enabled                         ║
║   ⏱️  Started: ${new Date().toLocaleString('id-ID')}   ║
╚════════════════════════════════════════════════╝
  `);
});

// ===== Graceful Shutdown =====
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});
