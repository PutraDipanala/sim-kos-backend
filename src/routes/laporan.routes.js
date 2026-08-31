// backend/src/routes/laporan.routes.js
const express = require('express');
const router = express.Router();
const laporanController = require('../controller/laporan.controller');
const { verifyToken, checkRole } = require('../middleware/authJWT');

const adminOnly = [
  verifyToken,
  checkRole('admin_desa', 'super_admin', 'admin_banjar'),
];

router.get('/keuangan', adminOnly, laporanController.getLaporanKeuangan);
router.get('/kependudukan', adminOnly, laporanController.getLaporanKependudukan);

module.exports = router;
