// backend/src/middleware/checkRoleMode.js

/**
 * Middleware checkRoleMode
 * Mengecek apakah user sedang dalam mode 'PEMILIK'.
 * Jika ya, blokir akses ke endpoint dengan pesan error 'Fitur sewa tidak tersedia dalam mode pemilik'.
 * Jika mode adalah 'PENYEWA', izinkan akses.
 */
module.exports = function checkRoleMode(req, res, next) {
  // Ambil role mode dari header request
  const roleMode = req.headers['x-role-mode'] || req.headers['role-mode'];

  if (roleMode && roleMode.toUpperCase() === 'PEMILIK') {
    return res.status(403).json({
      success: false,
      message: 'Fitur sewa tidak tersedia dalam mode pemilik'
    });
  }

  next();
};
