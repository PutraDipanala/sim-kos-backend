const express = require('express');
const router = express.Router();
const sewaController = require('../controller/sewa.controller');
const { verifyToken } = require('../middleware/authJWT');
const checkRoleMode = require('../middleware/checkRoleMode');

router.post('/', verifyToken, checkRoleMode, sewaController.createSewa);
router.get('/history', verifyToken, sewaController.getSewaHistoryByResidentAndRoom);
router.get('/user/:id_user', sewaController.getSewaByUser);
router.patch('/:id_sewa/status-kontrak', sewaController.updateStatusKontrak);

module.exports = router;

