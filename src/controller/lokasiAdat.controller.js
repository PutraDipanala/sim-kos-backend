// backend/src/controller/lokasiAdat.controller.js
const db = require('../config/db');

/**
 * GET Desa Adat berdasarkan kecamatan_id_api
 * Query param: kecamatanIdApi
 */
exports.getDesaAdat = async (req, res) => {
  try {
    const { kecamatanIdApi } = req.query;

    // Validasi parameter
    if (!kecamatanIdApi) {
      return res.status(400).json({ 
        message: 'Parameter kecamatanIdApi wajib diisi' 
      });
    }

    // Query ke tabel desa_adat
    const [rows] = await db.query(
      'SELECT id, nama FROM desa_adat WHERE kecamatan_id_api = ? ORDER BY nama',
      [kecamatanIdApi]
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
 * GET Banjar Adat berdasarkan desa_adat_id
 * Query param: desaAdatId
 */
exports.getBanjarAdat = async (req, res) => {
  try {
    const { desaAdatId } = req.query;

    // Validasi parameter
    if (!desaAdatId) {
      return res.status(400).json({ 
        message: 'Parameter desaAdatId wajib diisi' 
      });
    }

    // Query ke tabel banjar_adat
    const [rows] = await db.query(
      'SELECT id, nama FROM banjar_adat WHERE desa_adat_id = ? ORDER BY nama',
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
