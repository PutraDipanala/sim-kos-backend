const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const db = require('../config/db');

// ==================== HELPER: Generate JWT ====================
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      desa_adat_id: user.desa_adat_id,      // ✅ KONSISTEN dengan verifyToken
      banjar_adat_id: user.banjar_adat_id,  // ✅ KONSISTEN dengan verifyToken
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
};

// ==================== REGISTER ====================
exports.register = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validasi gagal',
      errors: errors.array(),
    });
  }

  const { name, email, password } = req.body;

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ 
        success: false,
        message: 'Email sudah terdaftar.' 
      });
    }

    const password_hash = await bcrypt.hash(password, 12);

    const [result] = await db.query(
      `INSERT INTO users 
       (name, email, password_hash, role, created_at) 
       VALUES (?, ?, ?, 'user', NOW())`,
      [name, email, password_hash]
    );

    res.status(201).json({
      success: true,
      message: 'Registrasi berhasil. Silakan login.',
      user: {
        id: result.insertId,
        name,
        email,
        role: 'user',
      },
    });
  } catch (error) {
    console.error('❌ Register error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Terjadi kesalahan server.' 
    });
  }
};

// ==================== LOGIN ====================
exports.login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validasi gagal',
      errors: errors.array(),
    });
  }

  const { email, password } = req.body;

  try {
    const [rows] = await db.query(
      `SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.password_hash, 
        u.role,
        u.desa_adat_id,
        u.banjar_adat_id,
        da.nama as desa_adat_nama,
        ba.nama as banjar_adat_nama
       FROM users u
       LEFT JOIN desa_adat da ON u.desa_adat_id = da.id
       LEFT JOIN banjar_adat ba ON u.banjar_adat_id = ba.id
       WHERE u.email = ?`,
      [email]
    );

    if (rows.length === 0) {
      return res.status(401).json({ 
        success: false,
        message: 'Email atau password salah.' 
      });
    }

    const user = rows[0];

    if (!user.password_hash) {
      console.error('❌ Password hash NULL untuk user:', email);
      return res.status(500).json({ 
        success: false,
        message: 'Data user tidak valid. Hubungi administrator.' 
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false,
        message: 'Email atau password salah.' 
      });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);

    await db.query(
      'UPDATE users SET refresh_token = ?, last_login = NOW() WHERE id = ?',
      [refreshToken, user.id]
    );

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    console.log('✅ Login berhasil:', { 
      id: user.id, 
      role: user.role, 
      desa_adat_id: user.desa_adat_id, 
      banjar_adat_id: user.banjar_adat_id 
    });

    res.json({
      success: true,
      message: 'Login berhasil.',
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        desa_adat_id: user.desa_adat_id,
        banjar_adat_id: user.banjar_adat_id,
        desa_adat_nama: user.desa_adat_nama,
        banjar_adat_nama: user.banjar_adat_nama,
      },
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Terjadi kesalahan server.' 
    });
  }
};

// ==================== REFRESH TOKEN ====================
exports.refreshToken = async (req, res) => {
  const { refreshToken } = req.cookies;

  if (!refreshToken) {
    return res.status(401).json({ 
      success: false,
      message: 'Refresh token tidak ada.' 
    });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    const [rows] = await db.query(
      `SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role, 
        u.desa_adat_id, 
        u.banjar_adat_id,
        da.nama as desa_adat_nama,
        ba.nama as banjar_adat_nama
       FROM users u
       LEFT JOIN desa_adat da ON u.desa_adat_id = da.id
       LEFT JOIN banjar_adat ba ON u.banjar_adat_id = ba.id
       WHERE u.id = ? AND u.refresh_token = ?`,
      [decoded.id, refreshToken]
    );

    if (rows.length === 0) {
      return res.status(403).json({ 
        success: false,
        message: 'Refresh token tidak valid.' 
      });
    }

    const user = rows[0];
    const newAccessToken = generateAccessToken(user);

    res.json({
      success: true,
      accessToken: newAccessToken,
    });
  } catch (error) {
    console.error('❌ Refresh token error:', error);
    return res.status(403).json({ 
      success: false,
      message: 'Token expired atau tidak valid.' 
    });
  }
};

// ==================== LOGOUT ====================
exports.logout = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (userId) {
      await db.query('UPDATE users SET refresh_token = NULL WHERE id = ?', [userId]);
    }

    res.clearCookie('refreshToken');

    res.json({ 
      success: true,
      message: 'Logout berhasil.' 
    });
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Terjadi kesalahan server.' 
    });
  }
};

// ==================== GET PROFILE ====================
exports.me = async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      `SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role,
        u.desa_adat_id,
        u.banjar_adat_id,
        da.nama as desa_adat_nama,
        ba.nama as banjar_adat_nama
       FROM users u
       LEFT JOIN desa_adat da ON u.desa_adat_id = da.id
       LEFT JOIN banjar_adat ba ON u.banjar_adat_id = ba.id
       WHERE u.id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: 'User tidak ditemukan.' 
      });
    }

    const user = rows[0];

    console.log('✅ GET /api/auth/me:', {
      id: user.id,
      role: user.role,
      desa_adat_id: user.desa_adat_id,
      banjar_adat_id: user.banjar_adat_id
    });

    res.json({ 
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        desa_adat_id: user.desa_adat_id,
        banjar_adat_id: user.banjar_adat_id,
        desa_adat_nama: user.desa_adat_nama,
        banjar_adat_nama: user.banjar_adat_nama,
      }
    });
  } catch (error) {
    console.error('❌ Get profile error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Terjadi kesalahan server.' 
    });
  }
};

// ==================== SWITCH ROLE ====================
exports.switchRole = async (req, res) => {
  try {
    const userId = req.user.id;
    const currentRole = req.user.role;
    const { targetRole } = req.body; // 'PEMILIK' or 'PENYEWA'

    if (!targetRole || !['PEMILIK', 'PENYEWA'].includes(targetRole.toUpperCase())) {
      return res.status(400).json({
        success: false,
        message: 'Role target tidak valid.'
      });
    }

    // Hindari mengubah role admin
    if (['super_admin', 'admin_desa', 'admin_banjar'].includes(currentRole)) {
      return res.status(403).json({
        success: false,
        message: 'Admin tidak diizinkan untuk beralih peran.'
      });
    }

    const newDbRole = targetRole.toUpperCase() === 'PEMILIK' ? 'pemilikKos' : 'user';

    // Update role di database
    await db.query('UPDATE users SET role = ? WHERE id = ?', [newDbRole, userId]);

    // Ambil data user yang diperbarui
    const [rows] = await db.query(
      `SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.role,
        u.desa_adat_id,
        u.banjar_adat_id,
        da.nama as desa_adat_nama,
        ba.nama as banjar_adat_nama
       FROM users u
       LEFT JOIN desa_adat da ON u.desa_adat_id = da.id
       LEFT JOIN banjar_adat ba ON u.banjar_adat_id = ba.id
       WHERE u.id = ?`,
      [userId]
    );

    const updatedUser = rows[0];
    const newAccessToken = generateAccessToken(updatedUser);
    const newRefreshToken = generateRefreshToken(updatedUser);

    // Update refresh token di DB
    await db.query('UPDATE users SET refresh_token = ? WHERE id = ?', [newRefreshToken, userId]);

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      message: `Berhasil beralih ke mode ${targetRole.toUpperCase() === 'PEMILIK' ? 'Pemilik' : 'Penyewa'}.`,
      accessToken: newAccessToken,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        desa_adat_id: updatedUser.desa_adat_id,
        banjar_adat_id: updatedUser.banjar_adat_id,
        desa_adat_nama: updatedUser.desa_adat_nama,
        banjar_adat_nama: updatedUser.banjar_adat_nama,
      }
    });
  } catch (error) {
    console.error('❌ Switch role error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server saat beralih peran.'
    });
  }
};