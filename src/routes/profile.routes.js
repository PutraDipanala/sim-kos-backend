// backend/src/routes/profile.routes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middleware/authJWT');
const upload = require('../config/multer'); // ✅ Sesuai path Anda

/**
 * GET /api/profile/me
 * Ambil profil user yang sedang login
 */
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      `SELECT 
        id, 
        email, 
        no_hp,
        name, 
        role,
        no_ktp,
        alamat_lengkap,
        tanggal_lahir,
        pekerjaan,
        foto_ktp,
        profile_completed,
        profile_completed_at,
        created_at
      FROM users 
      WHERE id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    res.json({
      success: true,
      data: rows[0]
    });

  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data profil',
      error: error.message
    });
  }
});

/**
 * PUT /api/profile/update
 * Update profil user
 */
router.put('/update', 
  verifyToken, 
  upload.single('foto_ktp'), 
  async (req, res) => {
    try {
      const userId = req.user.id;
      const { name, no_hp, no_ktp, alamat_lengkap, tanggal_lahir, pekerjaan } = req.body;

      // Ambil data user saat ini untuk COALESCE / fallback
      const [existingUserRows] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
      if (existingUserRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User tidak ditemukan'
        });
      }
      const existingUser = existingUserRows[0];

      // Validasi input wajib sesuai request user
      if (!name || !no_hp || !no_ktp || !alamat_lengkap) {
        return res.status(400).json({
          success: false,
          message: 'Nama Lengkap, Nomor HP, NIK, dan Alamat wajib diisi'
        });
      }

      // Validasi NIK 16 digit
      if (no_ktp.length !== 16 || !/^\d+$/.test(no_ktp)) {
        return res.status(400).json({
          success: false,
          message: 'NIK harus 16 digit angka'
        });
      }

      // Validasi alamat minimal 20 karakter
      if (alamat_lengkap.trim().length < 20) {
        return res.status(400).json({
          success: false,
          message: 'Alamat minimal 20 karakter'
        });
      }

      // Cek apakah ada upload foto KTP baru
      let fotoKtpPath = existingUser.foto_ktp;
      if (req.file) {
        fotoKtpPath = `/uploads/${req.file.filename}`;
      }

      // Gabungkan data opsional
      const finalTanggalLahir = tanggal_lahir || existingUser.tanggal_lahir;
      const finalPekerjaan = pekerjaan || existingUser.pekerjaan;

      // Update database
      await db.query(
        `UPDATE users 
        SET 
          name = ?,
          no_hp = ?,
          no_ktp = ?,
          alamat_lengkap = ?,
          tanggal_lahir = ?,
          pekerjaan = ?,
          foto_ktp = ?,
          profile_completed = TRUE,
          profile_completed_at = NOW()
        WHERE id = ?`,
        [name, no_hp, no_ktp, alamat_lengkap, finalTanggalLahir, finalPekerjaan, fotoKtpPath, userId]
      );

      // Ambil data terbaru untuk dikembalikan ke frontend
      const [updatedUser] = await db.query(
        `SELECT 
          id, email, no_hp, name, role,
          no_ktp, alamat_lengkap, tanggal_lahir, pekerjaan,
          foto_ktp, profile_completed, profile_completed_at
        FROM users 
        WHERE id = ?`,
        [userId]
      );

      res.json({
        success: true,
        message: 'Profil berhasil dilengkapi',
        data: updatedUser[0]
      });

    } catch (error) {
      console.error('Error updating profile:', error);
      res.status(500).json({
        success: false,
        message: 'Gagal memperbarui profil',
        error: error.message
      });
    }
});

/**
 * GET /api/profile/check-completion
 * Cek status profil lengkap
 */
router.get('/check-completion', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      'SELECT profile_completed FROM users WHERE id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    res.json({
      success: true,
      profile_completed: rows[0].profile_completed === 1
    });

  } catch (error) {
    console.error('Error checking profile:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal cek profil'
    });
  }
});

module.exports = router;
