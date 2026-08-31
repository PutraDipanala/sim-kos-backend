// backend/src/routes/lokasiAdat.routes.js
const express = require('express');
const router = express.Router();
const lokasiAdatController = require('../controller/lokasiAdat.controller');

/**
 * GET /api/lokasi-adat/desa-adat?kecamatanIdApi=5171030
 * Mengembalikan list desa adat untuk 1 kecamatan
 */
router.get('/desa-adat', lokasiAdatController.getDesaAdat);

/**
 * GET /api/lokasi-adat/banjar-adat?desaAdatId=1
 * Mengembalikan list banjar adat untuk 1 desa adat
 */
router.get('/banjar-adat', lokasiAdatController.getBanjarAdat);

module.exports = router;
