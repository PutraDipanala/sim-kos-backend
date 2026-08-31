// backend/src/app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const session = require('express-session');
const db = require('./config/db');

// import routes
const authRoutes = require('./routes/auth.routes');
const kosRoutes = require('./routes/kos.routes');
const adminBanjarRoutes = require('./routes/adminBanjar.routes');
const lokasiAdatRoutes = require('./routes/lokasiAdat.routes');
const fasilitasRoutes = require('./routes/fasilitas.routes'); // ✅ TAMBAH
const profileRoutes = require('./routes/profile.routes');     // ✅ TAMBAH
const sewaRoutes = require('./routes/sewa.routes');
const paymentRoutes = require('./routes/payment.routes');     // ✅ Midtrans Webhook
const wilayahRoutes = require('./routes/wilayah.routes');     // ✅ Endpoint Wilayah Dinamis
const iuranRoutes  = require('./routes/iuran.routes');        // ✅ Manajemen Iuran Desa
const billingRoutes = require('./routes/billing.routes');      // ✅ Sistem Billing Otomatis
const kamarRoutes = require('./routes/kamar.routes');          // ✅ CRUD Kamar Kos
const withdrawRoutes = require('./routes/withdraw.routes');    // ✅ TAMBAH: Withdraw Saldo Pemilik Kos
const adminRoutes = require('./routes/admin.routes');          // ✅ TAMBAH: Monitoring & Admin khusus
const aduanRoutes = require('./routes/aduan.routes');          // ✅ TAMBAH: Pusat Aspirasi
const laporanRoutes = require('./routes/laporan.routes');      // ✅ TAMBAH: Pusat Laporan



const app = express();

// ====== TRUST PROXY ======
// Diperlukan saat menggunakan ngrok / reverse proxy (production: Nginx, dll.)
// Agar express-rate-limit dan IP detection bekerja dengan benar.
app.set('trust proxy', 1);

// ====== MIDDLEWARE DASAR ======
app.use(helmet());
app.use(express.json());

// CORS
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-role-mode', 'role-mode'],
  })
);

// ====== SERVE STATIC FILES (untuk uploads) ======
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ====== SESSION CONFIG ======
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'dev_secret_ganti_env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
};

app.use(session(sessionConfig));

// ====== HEALTH CHECK ======
app.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT 1 AS ok');
    res.json({
      message: 'API SIM Kos Desa Adat berjalan',
      db_ok: rows[0].ok === 1,
    });
  } catch (error) {
    res.status(500).json({ message: 'Database error', error: error.message });
  }
});

// ====== PASANG ROUTES ======
app.use('/api/auth', authRoutes);
app.use('/api/kos', kosRoutes);
app.use('/api/admin/banjar', adminBanjarRoutes);
app.use('/api/lokasi-adat', lokasiAdatRoutes);
app.use('/api/fasilitas', fasilitasRoutes);  // ✅ TAMBAH
app.use('/api/profile', profileRoutes);      // ✅ TAMBAH
app.use('/api/sewa', sewaRoutes);
app.use('/api/payment', paymentRoutes);     // ✅ Midtrans Webhook Notification
app.use('/api/wilayah', wilayahRoutes);     // ✅ Endpoint Wilayah Dinamis
app.use('/api/iuran',   iuranRoutes);       // ✅ Manajemen Iuran Desa
app.use('/api/billing', billingRoutes);     // ✅ Sistem Billing Otomatis
app.use('/api/kamar-kos', kamarRoutes);     // ✅ CRUD Kamar Kos
app.use('/api/withdraw', withdrawRoutes);    // ✅ TAMBAH: Withdraw Saldo Pemilik Kos
app.use('/api/admin', adminRoutes);          // ✅ TAMBAH: Monitoring & Admin khusus
app.use('/api/aduan', aduanRoutes);          // ✅ TAMBAH: Pusat Aspirasi
app.use('/api/laporan', laporanRoutes);      // ✅ TAMBAH: Pusat Laporan



// 404 fallback sederhana
app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint tidak ditemukan.' });
});

module.exports = app;
