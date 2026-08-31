// backend/src/routes/admin.routes.js
const express = require('express');
const router = express.Router();
const adminController = require('../controller/admin.controller');
const { verifyToken, checkRole, checkWilayah } = require('../middleware/authJWT');

/**
 * GET /api/admin/monitoring
 * Endpoint monitoring sebaran hunian kos
 */
router.get('/monitoring',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  checkWilayah,
  adminController.getMonitoringData
);

/**
 * GET /api/admin/unsynced-penghuni
 * Endpoint mendapatkan daftar penghuni belum tersinkronisasi kamar
 */
router.get('/unsynced-penghuni',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  checkWilayah,
  adminController.getUnsyncedPenghuni
);

/**
 * POST /api/admin/sinkronisasi-penghuni
 * Endpoint sinkronisasi kamar untuk penghuni baru
 */
router.post('/sinkronisasi-penghuni',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  adminController.sinkronisasiPenghuni
);

module.exports = router;
