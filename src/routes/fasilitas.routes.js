// backend/src/routes/fasilitas.routes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db');

/**
 * GET /api/fasilitas
 * Ambil semua master fasilitas (PUBLIC - untuk form pengajuan & EditKosModal)
 */
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nama FROM fasilitas_master ORDER BY id'
    );

    res.json({
      success: true,
      fasilitas: rows
    });
  } catch (error) {
    console.error('Error fetching fasilitas:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data fasilitas',
      error: error.message
    });
  }
});

/**
 * POST /api/fasilitas
 * Tambah fasilitas baru (ADMIN ONLY - optional untuk future development)
 */
router.post('/', async (req, res) => {
  try {
    const { nama } = req.body;

    if (!nama || nama.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Nama fasilitas tidak boleh kosong'
      });
    }

    // Check duplicate
    const [existing] = await db.query(
      'SELECT id FROM fasilitas_master WHERE nama = ?',
      [nama]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Fasilitas sudah ada'
      });
    }

    // Insert
    const [result] = await db.query(
      'INSERT INTO fasilitas_master (nama, created_at) VALUES (?, NOW())',
      [nama]
    );

    res.status(201).json({
      success: true,
      message: 'Fasilitas berhasil ditambahkan',
      data: {
        id: result.insertId,
        nama
      }
    });
  } catch (error) {
    console.error('Error adding fasilitas:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menambahkan fasilitas',
      error: error.message
    });
  }
});

module.exports = router;