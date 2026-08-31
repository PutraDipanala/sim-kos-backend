// backend/src/routes/kamar.routes.js
const express = require('express');
const router = express.Router();
const kamarController = require('../controller/kamar.controller');

/**
 * GET /api/kamar-kos?id_kos=:id&status=tersedia
 * Ambil daftar kamar berdasarkan kos. Support filter status.
 */
router.get('/', kamarController.getKamarByKos);

/**
 * POST /api/kamar-kos
 * Tambah kamar baru ke kos tertentu.
 * Body: { id_kos, nomor_kamar, harga_kamar }
 */
router.post('/', kamarController.createKamar);

/**
 * PUT /api/kamar-kos/:id
 * Update data kamar (nomor, harga).
 * Body: { nomor_kamar, harga_kamar }
 */
router.put('/:id', kamarController.updateKamar);

/**
 * DELETE /api/kamar-kos/:id
 * Hapus kamar (hanya jika status = 'tersedia').
 */
router.delete('/:id', kamarController.deleteKamar);

/**
 * PATCH /api/kamar-kos/:id/status
 * Update status ketersediaan kamar.
 * Body: { status_ketersediaan: 'tersedia' | 'dipesan' | 'terisi' }
 */
router.patch('/:id/status', kamarController.updateStatusKamar);

module.exports = router;
