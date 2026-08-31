// backend/src/routes/wilayah.routes.js
const express = require('express');
const router = express.Router();
const wilayahController = require('../controller/wilayah.controller');

// GET /api/wilayah/kabupaten
router.get('/kabupaten', wilayahController.getKabupaten);

// GET /api/wilayah/kecamatan?kabupatenId=...
router.get('/kecamatan', wilayahController.getKecamatan);

// GET /api/wilayah/desa-adat?kecamatanId=...
router.get('/desa-adat', wilayahController.getDesaAdat);

// GET /api/wilayah/banjar-adat?desaAdatId=...
router.get('/banjar-adat', wilayahController.getBanjarAdat);

module.exports = router;
