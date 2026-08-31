const jwt = require('jsonwebtoken');

// ✅ Middleware: Verify JWT Token
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false,
      message: 'Token tidak ditemukan.' 
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ Attach user data ke request (KONSISTEN dengan JWT payload)
    req.user = {
      id: decoded.id,
      role: decoded.role,
      desa_adat_id: decoded.desa_adat_id,    // ✅ Konsisten
      banjar_adat_id: decoded.banjar_adat_id, // ✅ Konsisten
    };

    console.log('✅ Token verified:', { 
      id: req.user.id, 
      role: req.user.role,
      desa_adat_id: req.user.desa_adat_id,
      banjar_adat_id: req.user.banjar_adat_id
    });

    next();
  } catch (error) {
    console.error('❌ Token error:', error.message);
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ 
        success: false,
        message: 'Token expired.', 
        expired: true 
      });
    }
    return res.status(403).json({ 
      success: false,
      message: 'Token tidak valid.' 
    });
  }
};

// ✅ Middleware: Check Role
exports.checkRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false,
        message: 'Unauthorized.' 
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      console.log(`❌ Access denied: ${req.user.role} not in [${allowedRoles.join(', ')}]`);
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Role Anda tidak memiliki izin.',
      });
    }

    console.log(`✅ Role check passed: ${req.user.role}`);
    next();
  };
};

// ✅ Middleware: Check & Filter Wilayah (untuk query kos)
exports.checkWilayah = (req, res, next) => {
  const user = req.user;

  console.log('🔍 Check wilayah:', { 
    role: user.role, 
    desa_adat_id: user.desa_adat_id, 
    banjar_adat_id: user.banjar_adat_id 
  });

  // Super admin bisa akses semua
  if (user.role === 'super_admin') {
    req.wilayahFilter = {}; // No filter
    console.log('✅ Super admin: akses semua wilayah');
    return next();
  }

  // Admin desa: filter by desa_adat_id
  if (user.role === 'admin_desa') {
    if (!user.desa_adat_id) {
      return res.status(403).json({
        success: false,
        message: 'Admin desa harus memiliki desa_adat_id yang valid.'
      });
    }

    req.wilayahFilter = {
      desa_adat_id: user.desa_adat_id,
    };
    console.log('✅ Admin desa: filter by desa_adat_id =', user.desa_adat_id);
    return next();
  }

  // Admin banjar: filter by banjar_adat_id
  if (user.role === 'admin_banjar') {
    if (!user.banjar_adat_id) {
      return res.status(403).json({
        success: false,
        message: 'Admin banjar harus memiliki banjar_adat_id yang valid.'
      });
    }

    req.wilayahFilter = {
      desa_adat_id: user.desa_adat_id,      // Admin banjar juga perlu filter desa
      banjar_adat_id: user.banjar_adat_id,
    };
    console.log('✅ Admin banjar: filter by banjar_adat_id =', user.banjar_adat_id);
    return next();
  }

  // Default: role tidak dikenali
  console.log('❌ Role tidak dikenali:', user.role);
  return res.status(403).json({ 
    success: false,
    message: 'Akses ditolak.' 
  });
};