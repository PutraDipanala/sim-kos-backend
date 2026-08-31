// backend/src/middleware/requireRole.js
module.exports = function requireRole(role) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ message: 'Belum login.' });
    }
    if (req.session.user.role !== role) {
      return res.status(403).json({ message: 'Tidak punya akses.' });
    }
    next();
  };
};
