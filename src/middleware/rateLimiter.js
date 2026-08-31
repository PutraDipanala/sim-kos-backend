// backend/src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// Login rate limiter: max 10 login attempts per 15 minutes
exports.loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// General API rate limiter
exports.apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300, // Dinaikkan dari 100 → 300 agar normal usage tidak terkena limit
  message: {
    message: 'Terlalu banyak request. Coba lagi nanti.',
  },
  skip: (req) => {
    // Pengecualian: iuran (bulk distribution) dan auth/me (status check ringan)
    return (
      req.originalUrl.startsWith('/api/iuran') ||
      req.originalUrl.startsWith('/api/auth/me') ||
      req.originalUrl.startsWith('/api/auth/logout')
    );
  },
});

