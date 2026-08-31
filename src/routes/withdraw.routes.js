const express = require('express');
const router = express.Router();
const withdrawController = require('../controller/withdraw.controller');
const { verifyToken, checkRole } = require('../middleware/authJWT');

/**
 * GET /api/withdraw/balance
 * Mengambil saldo pemilik kos beserta riwayat penarikan dana.
 */
router.get('/balance', verifyToken, checkRole('pemilikKos'), withdrawController.getOwnerBalance);

/**
 * POST /api/withdraw
 * Mengajukan permintaan penarikan dana baru.
 */
router.post('/', verifyToken, checkRole('pemilikKos'), withdrawController.requestWithdraw);

module.exports = router;
