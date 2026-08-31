// backend/src/routes/billing.routes.js
const express = require('express');
const router = express.Router();
const billingController = require('../controller/billing.controller');

/**
 * POST /api/billing/generate
 * Endpoint untuk memicu generate tagihan otomatis (sewa & iuran) bulan ini.
 */
router.post('/generate', billingController.generateTagihanBulanIni);

module.exports = router;
