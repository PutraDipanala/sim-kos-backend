// backend/src/routes/iuran.routes.js
const express        = require('express');
const router         = express.Router();
const iuranController = require('../controller/iuran.controller');
const { verifyToken, checkRole } = require('../middleware/authJWT');

// ── Pemilik Kos Routes ────────────────────────────────────────────────────────
const pemilikOnly = [verifyToken, checkRole('pemilikKos')];

/**
 * GET /api/iuran/pemilik/tagihan
 * Daftar tagihan iuran desa yang diterima oleh pemilik kos yang sedang login.
 */
router.get('/pemilik/tagihan', pemilikOnly, iuranController.getTagihanPemilik);

/**
 * POST /api/iuran/pemilik/bayar
 * Membuat Midtrans Snap Token untuk membayar tagihan iuran tertentu.
 * Body: { tagihan_id }
 */
router.post('/pemilik/bayar', pemilikOnly, iuranController.initiateBayarIuran);

// ── Admin Routes ──────────────────────────────────────────────────────────────
const adminOnly = [
  verifyToken,
  checkRole('admin_desa', 'super_admin'),
];

const viewOnlyRoles = [
  verifyToken,
  checkRole('admin_desa', 'super_admin', 'admin_banjar'),
];

/**
 * POST /api/iuran
 * Membuat template iuran baru DAN langsung mendistribusikannya (1 langkah).
 * Body: { nama_iuran, nominal, batas_pembayaran, kategori }
 */
router.post('/', adminOnly, iuranController.createIuranAndDistribute);

/**
 * GET /api/iuran
 * Mendapatkan daftar seluruh iuran milik desa_adat Admin yang login,
 * beserta ringkasan jumlah tagihan lunas vs. pending.
 */
router.get('/', viewOnlyRoles, iuranController.getIuranList);

/**
 * GET /api/iuran/:id/tagihan
 * Mendapatkan detail tagihan per-pemilik untuk satu template iuran.
 */
router.get('/:id/tagihan', viewOnlyRoles, iuranController.getTagihanByIuran);

/**
 * PATCH /api/iuran/tagihan/:tagihanId/confirm
 * Konfirmasi pembayaran secara manual oleh Admin (cadangan untuk bayar tunai).
 * Otomasi utama dilakukan via Midtrans webhook di payment.controller.js.
 */
router.patch('/tagihan/:tagihanId/confirm', adminOnly, iuranController.confirmManual);

/**
 * PATCH /api/iuran/:id
 * Memperbarui template iuran (nama, nominal, kategori, is_recurring, status_template).
 */
router.patch('/:id', adminOnly, iuranController.updateIuran);

/**
 * DELETE /api/iuran/:id
 * Menghapus template iuran (cascade menghapus semua tagihan terkait).
 */
router.delete('/:id', adminOnly, iuranController.deleteIuran);

module.exports = router;

