// backend/src/controller/wilayah.controller.js
const db = require('../config/db');

/**
 * GET /api/wilayah/kabupaten
 * Mengambil data kabupaten di Bali (Provinsi ID: 51) via Emsifa API
 */
exports.getKabupaten = async (req, res) => {
  try {
    const response = await fetch('https://emsifa.github.io/api-wilayah-indonesia/api/regencies/51.json');
    if (!response.ok) {
      throw new Error('Gagal mengambil data dari API eksternal');
    }
    const data = await response.json();
    
    // Sort by name A-Z
    data.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      success: true,
      data,
      total: data.length
    });
  } catch (error) {
    console.error('Error getKabupaten:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data kabupaten',
      error: error.message
    });
  }
};

/**
 * GET /api/wilayah/kecamatan
 * Mengambil data kecamatan berdasarkan kabupatenId via Emsifa API
 */
exports.getKecamatan = async (req, res) => {
  try {
    const { kabupatenId } = req.query;

    if (!kabupatenId) {
      return res.status(400).json({
        success: false,
        message: 'Parameter kabupatenId wajib diisi'
      });
    }

    const response = await fetch(`https://emsifa.github.io/api-wilayah-indonesia/api/districts/${kabupatenId}.json`);
    if (!response.ok) {
      throw new Error('Gagal mengambil data kecamatan dari API eksternal');
    }
    const data = await response.json();

    // Sort by name A-Z
    data.sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      success: true,
      data,
      total: data.length
    });
  } catch (error) {
    console.error('Error getKecamatan:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data kecamatan',
      error: error.message
    });
  }
};

/**
 * GET /api/wilayah/desa-adat
 * Mengambil data desa adat dari database berdasarkan kecamatanId
 */
exports.getDesaAdat = async (req, res) => {
  try {
    const { kecamatanId } = req.query;

    if (!kecamatanId) {
      return res.status(400).json({
        success: false,
        message: 'Parameter kecamatanId wajib diisi'
      });
    }

    // Menggunakan query SQL dan parameterized statement untuk mencegah SQL injection
    const [rows] = await db.query(
      'SELECT id, nama FROM desa_adat WHERE kecamatan_id_api = ? ORDER BY nama ASC',
      [kecamatanId]
    );

    res.json({
      success: true,
      data: rows,
      total: rows.length
    });
  } catch (error) {
    console.error('Error getDesaAdat:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data desa adat',
      error: error.message
    });
  }
};

/**
 * GET /api/wilayah/banjar-adat
 * Mengambil data banjar adat dari database berdasarkan desaAdatId
 */
exports.getBanjarAdat = async (req, res) => {
  try {
    const { desaAdatId } = req.query;

    if (!desaAdatId) {
      return res.status(400).json({
        success: false,
        message: 'Parameter desaAdatId wajib diisi'
      });
    }

    // Menggunakan query SQL dan parameterized statement untuk mencegah SQL injection
    const [rows] = await db.query(
      'SELECT id, nama FROM banjar_adat WHERE desa_adat_id = ? ORDER BY nama ASC',
      [desaAdatId]
    );

    res.json({
      success: true,
      data: rows,
      total: rows.length
    });
  } catch (error) {
    console.error('Error getBanjarAdat:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data banjar adat',
      error: error.message
    });
  }
};
