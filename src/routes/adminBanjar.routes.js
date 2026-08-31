// backend/src/routes/adminBanjar.routes.js
const express = require('express');
const router = express.Router();

// (opsional) middleware kalau hanya admin yg boleh akses
// const requireAuth = require('../middleware/requireAuth');

/**
 * TEST endpoint
 * GET /api/admin/banjar
 */
router.get('/', (req, res) => {
  res.json({ message: 'Admin Banjar routes OK' });
});

/**
 * Nanti ini cocok untuk master data:
 * GET /api/admin/banjar?desaAdatId=...
 * POST /api/admin/banjar
 * PUT /api/admin/banjar/:id
 * DELETE /api/admin/banjar/:id
 */

module.exports = router;
