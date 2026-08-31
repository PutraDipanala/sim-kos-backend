// backend/src/middleware/requireAuth.js
// Middleware untuk session-based authentication (backward compatibility)

module.exports = function requireAuth(req, res, next) {
  // Cek apakah user sudah login via session
  if (!req.session || !req.session.user) {
    return res.status(401).json({ message: 'Belum login.' });
  }
  
  // Attach user dari session ke req.user
  req.user = req.session.user;
  
  next();
};
