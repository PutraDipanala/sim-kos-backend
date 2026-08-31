// backend/src/routes/aduan.routes.js
const express = require('express');
const router = express.Router();
const aduanController = require('../controller/aduan.controller');
const { verifyToken, checkRole } = require('../middleware/authJWT');
const {
  createAduanValidation,
  respondAduanValidation,
  forwardAduanValidation,
} = require('../middleware/validation');

const adminOnly = [
  verifyToken,
  checkRole('super_admin', 'admin', 'admin_desa', 'admin_banjar'),
];

/**
 * @route   POST /api/aduan
 * @desc    Kirim aduan baru (Wajib login & profile_completed = 1)
 * @access  Private (User / Pemilik Kos)
 */
router.post('/',
  verifyToken,
  createAduanValidation,
  aduanController.createAduan
);

/**
 * @route   GET /api/aduan
 * @desc    Ambil daftar aduan (filter otomatis per role & wilayah)
 * @access  Private (All Roles)
 */
router.get('/',
  verifyToken,
  aduanController.getAduan
);

/**
 * @route   PUT /api/aduan/:id
 * @desc    Tanggapi aduan dan ubah status
 * @access  Private (Admin Only)
 */
router.put('/:id',
  ...adminOnly,
  respondAduanValidation,
  aduanController.respondAduan
);

/**
 * @route   POST /api/aduan/:id/forward
 * @desc    Eskalasi / forward aduan ke level admin lebih tinggi
 *          admin_banjar → admin_desa, admin_desa → super_admin
 * @access  Private (admin_banjar, admin_desa)
 */
router.post('/:id/forward',
  verifyToken,
  checkRole('admin_banjar', 'admin_desa'),
  forwardAduanValidation,
  aduanController.forwardAduan
);

/**
 * @route   GET /api/aduan/:id/logs
 * @desc    Riwayat audit log aduan (kapan & oleh siapa diforward/ditanggapi)
 * @access  Private (pemilik aduan atau admin)
 */
router.get('/:id/logs',
  verifyToken,
  aduanController.getAduanLogs
);

module.exports = router;
