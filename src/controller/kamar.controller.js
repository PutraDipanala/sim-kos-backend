// backend/src/controller/kamar.controller.js
const db = require('../config/db');

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * KAMAR KOS CONTROLLER — CRUD + Status Management
 * ─────────────────────────────────────────────────────────────────────────────
 * Mengelola data kamar per kos. Setiap kamar memiliki harga sendiri
 * (harga_kamar) dan status ketersediaan (tersedia/dipesan/terisi).
 */

// =========================================================================
// 1. GET KAMAR BY KOS
// =========================================================================
// GET /api/kamar-kos?id_kos=:id&status=tersedia
// Query params:
//   - id_kos (required): ID kos
//   - status (optional): filter berdasarkan status_ketersediaan
exports.getKamarByKos = async (req, res) => {
  try {
    const { id_kos, status } = req.query;

    if (!id_kos) {
      return res.status(400).json({
        success: false,
        message: 'Parameter id_kos wajib diisi.'
      });
    }

    // 1. Cek apakah ada kamar sama sekali untuk kos ini (tanpa filter status terlebih dahulu)
    const [existingCheck] = await db.query(
      `SELECT kf.id FROM kamar_fisik kf
       JOIN kamar_tipe kt ON kf.id_tipe = kt.id
       WHERE kt.id_kos = ? LIMIT 1`,
      [id_kos]
    );

    // 2. Jika belum ada kamar sama sekali, auto-generate berdasarkan jumlah_kamar & harga_sewa dari tabel kos
    if (existingCheck.length === 0) {
      const [kosRows] = await db.query(
        'SELECT jumlah_kamar, harga_sewa FROM kos WHERE id = ?',
        [id_kos]
      );
      
      if (kosRows.length > 0) {
        const { jumlah_kamar, harga_sewa } = kosRows[0];
        if (jumlah_kamar && jumlah_kamar > 0) {
          // Check if there is already a tipe Standar
          let [tipeRows] = await db.query(
            'SELECT id FROM kamar_tipe WHERE id_kos = ? AND nama_tipe = ? LIMIT 1',
            [id_kos, 'Standar']
          );
          let idTipe;
          if (tipeRows.length > 0) {
            idTipe = tipeRows[0].id;
          } else {
            const [tipeResult] = await db.query(
              'INSERT INTO kamar_tipe (id_kos, nama_tipe, harga_kamar) VALUES (?, ?, ?)',
              [id_kos, 'Standar', harga_sewa || 0]
            );
            idTipe = tipeResult.insertId;
          }

          const values = [];
          for (let i = 1; i <= jumlah_kamar; i++) {
            values.push([idTipe, String(i), 'tersedia']);
          }
          if (values.length > 0) {
            await db.query(
              'INSERT INTO kamar_fisik (id_tipe, nomor_kamar, status_ketersediaan) VALUES ?',
              [values]
            );
            console.log(`[Kamar] ⚡ Auto-generated ${jumlah_kamar} kamar untuk kos ID ${id_kos} dengan tipe default Standar.`);
          }
        }
      }
    }

    // 3. Ambil data kamar (dengan filter status opsional)
    let query = `
      SELECT
        kf.id,
        kt.id_kos,
        kf.nomor_kamar,
        kt.harga_kamar,
        kt.nama_tipe,
        kf.status_ketersediaan
      FROM kamar_fisik kf
      JOIN kamar_tipe kt ON kf.id_tipe = kt.id
      WHERE kt.id_kos = ?
    `;
    const params = [id_kos];

    // Filter opsional berdasarkan status
    if (status) {
      query += ' AND kf.status_ketersediaan = ?';
      params.push(status);
    }

    // Urutkan nomor kamar secara numerik (jika berupa angka) agar rapi
    query += ' ORDER BY CAST(kf.nomor_kamar AS UNSIGNED) ASC, kf.nomor_kamar ASC';

    const [rows] = await db.query(query, params);

    return res.status(200).json({
      success: true,
      message: `Ditemukan ${rows.length} kamar.`,
      data: rows
    });

  } catch (error) {
    console.error('[Kamar] ❌ Error getKamarByKos:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data kamar.',
      error: error.message
    });
  }
};

// =========================================================================
// 2. CREATE KAMAR
// =========================================================================
// POST /api/kamar-kos
// Body: { id_kos, nomor_kamar, harga_kamar }
exports.createKamar = async (req, res) => {
  try {
    const { id_kos, nomor_kamar, harga_kamar } = req.body;

    // Validasi input
    if (!id_kos || !nomor_kamar || !harga_kamar) {
      return res.status(400).json({
        success: false,
        message: 'Field id_kos, nomor_kamar, and harga_kamar wajib diisi.'
      });
    }

    if (harga_kamar < 0) {
      return res.status(400).json({
        success: false,
        message: 'Harga kamar tidak boleh negatif.'
      });
    }

    // Validasi kos ada
    const [kosRows] = await db.query('SELECT id FROM kos WHERE id = ?', [id_kos]);
    if (kosRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Data kos tidak ditemukan.'
      });
    }

    // Validasi nomor kamar unik dalam 1 kos
    const [existing] = await db.query(
      `SELECT kf.id FROM kamar_fisik kf
       JOIN kamar_tipe kt ON kf.id_tipe = kt.id
       WHERE kt.id_kos = ? AND kf.nomor_kamar = ?`,
      [id_kos, nomor_kamar]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Kamar "${nomor_kamar}" sudah ada di kos ini.`
      });
    }

    // Cari/Buat kamar_tipe untuk kos ini dengan harga tersebut
    let [tipeRows] = await db.query(
      'SELECT id FROM kamar_tipe WHERE id_kos = ? AND harga_kamar = ? LIMIT 1',
      [id_kos, harga_kamar]
    );
    let id_tipe;
    if (tipeRows.length > 0) {
      id_tipe = tipeRows[0].id;
    } else {
      const [tipeResult] = await db.query(
        'INSERT INTO kamar_tipe (id_kos, nama_tipe, harga_kamar) VALUES (?, ?, ?)',
        [id_kos, 'Standar', harga_kamar]
      );
      id_tipe = tipeResult.insertId;
    }

    // Insert kamar baru di kamar_fisik
    const [result] = await db.query(
      `INSERT INTO kamar_fisik (id_tipe, nomor_kamar, status_ketersediaan)
       VALUES (?, ?, 'tersedia')`,
      [id_tipe, nomor_kamar]
    );

    console.log(`[Kamar] ✅ Kamar "${nomor_kamar}" ditambahkan ke tipe ID ${id_tipe}.`);

    return res.status(201).json({
      success: true,
      message: `Kamar "${nomor_kamar}" berhasil ditambahkan.`,
      data: {
        id: result.insertId,
        id_kos,
        nomor_kamar,
        harga_kamar,
        status_ketersediaan: 'tersedia'
      }
    });

  } catch (error) {
    console.error('[Kamar] ❌ Error createKamar:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal menambahkan kamar.',
      error: error.message
    });
  }
};

// =========================================================================
// 3. UPDATE KAMAR
// =========================================================================
// PUT /api/kamar-kos/:id
// Body: { nomor_kamar, harga_kamar }
exports.updateKamar = async (req, res) => {
  try {
    const { id } = req.params;
    const { nomor_kamar, harga_kamar } = req.body;

    if (!nomor_kamar || !harga_kamar) {
      return res.status(400).json({
        success: false,
        message: 'Field nomor_kamar dan harga_kamar wajib diisi.'
      });
    }

    // Cek kamar ada
    const [kamarRows] = await db.query(
      `SELECT kf.*, kt.id_kos, kt.harga_kamar FROM kamar_fisik kf
       JOIN kamar_tipe kt ON kf.id_tipe = kt.id
       WHERE kf.id = ?`,
      [id]
    );
    if (kamarRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kamar tidak ditemukan.'
      });
    }

    const kamar = kamarRows[0];

    // Cek nomor kamar unik (jika berubah)
    if (nomor_kamar !== kamar.nomor_kamar) {
      const [dup] = await db.query(
        `SELECT kf.id FROM kamar_fisik kf
         JOIN kamar_tipe kt ON kf.id_tipe = kt.id
         WHERE kt.id_kos = ? AND kf.nomor_kamar = ? AND kf.id != ?`,
        [kamar.id_kos, nomor_kamar, id]
      );
      if (dup.length > 0) {
        return res.status(409).json({
          success: false,
          message: `Nomor kamar "${nomor_kamar}" sudah digunakan di kos ini.`
        });
      }
    }

    // Update nomor_kamar di kamar_fisik
    await db.query('UPDATE kamar_fisik SET nomor_kamar = ? WHERE id = ?', [nomor_kamar, id]);
    
    // Update harga_kamar di kamar_tipe
    await db.query('UPDATE kamar_tipe SET harga_kamar = ? WHERE id = ?', [harga_kamar, kamar.id_tipe]);

    console.log(`[Kamar] ✅ Kamar ID ${id} diperbarui.`);

    return res.status(200).json({
      success: true,
      message: 'Data kamar berhasil diperbarui.',
      data: { id: parseInt(id), nomor_kamar, harga_kamar }
    });

  } catch (error) {
    console.error('[Kamar] ❌ Error updateKamar:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui data kamar.',
      error: error.message
    });
  }
};

// =========================================================================
// 4. DELETE KAMAR
// =========================================================================
// DELETE /api/kamar-kos/:id
// Hanya bisa menghapus kamar yang status = 'tersedia'
exports.deleteKamar = async (req, res) => {
  try {
    const { id } = req.params;

    const [kamarRows] = await db.query('SELECT * FROM kamar_fisik WHERE id = ?', [id]);
    if (kamarRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kamar tidak ditemukan.'
      });
    }

    const kamar = kamarRows[0];

    // Proteksi: tidak bisa hapus kamar yang sedang terisi atau dipesan
    if (kamar.status_ketersediaan !== 'tersedia') {
      return res.status(400).json({
        success: false,
        message: `Kamar "${kamar.nomor_kamar}" tidak bisa dihapus karena statusnya "${kamar.status_ketersediaan}". Selesaikan/batalkan kontrak sewa terlebih dahulu.`
      });
    }

    await db.query('DELETE FROM kamar_fisik WHERE id = ?', [id]);

    console.log(`[Kamar] 🗑️ Kamar "${kamar.nomor_kamar}" (ID ${id}) dihapus.`);

    return res.status(200).json({
      success: true,
      message: `Kamar "${kamar.nomor_kamar}" berhasil dihapus.`
    });

  } catch (error) {
    console.error('[Kamar] ❌ Error deleteKamar:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus kamar.',
      error: error.message
    });
  }
};

// =========================================================================
// 5. UPDATE STATUS KAMAR (DIRECT & CONTROLLER)
// =========================================================================

/**
 * updateStatusKamarDirect
 * Fungsi utility untuk mengupdate status ketersediaan kamar secara langsung di database.
 * Dapat dipanggil secara internal oleh controller lain (seperti sewa.controller.js).
 */
exports.updateStatusKamarDirect = async (id_kamar, status) => {
  const validStatus = ['tersedia', 'dipesan', 'terisi'];
  if (!validStatus.includes(status)) {
    throw new Error(`Status tidak valid. Harus salah satu dari: ${validStatus.join(', ')}`);
  }

  const [result] = await db.query(
    'UPDATE kamar_fisik SET status_ketersediaan = ? WHERE id = ?',
    [status, id_kamar]
  );
  return result;
};

// PATCH /api/kamar-kos/:id/status
// Body: { status_ketersediaan: 'tersedia' | 'dipesan' | 'terisi' }
exports.updateStatusKamar = async (req, res) => {
  try {
    const { id } = req.params;
    const { status_ketersediaan } = req.body;

    const validStatus = ['tersedia', 'dipesan', 'terisi'];
    if (!validStatus.includes(status_ketersediaan)) {
      return res.status(400).json({
        success: false,
        message: `Status harus salah satu dari: ${validStatus.join(', ')}`
      });
    }

    const [kamarRows] = await db.query('SELECT * FROM kamar_fisik WHERE id = ?', [id]);
    if (kamarRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kamar tidak ditemukan.'
      });
    }

    await exports.updateStatusKamarDirect(id, status_ketersediaan);

    console.log(`[Kamar] 🔄 Status kamar ID ${id} → "${status_ketersediaan}" via API.`);

    return res.status(200).json({
      success: true,
      message: `Status kamar berhasil diubah ke "${status_ketersediaan}".`
    });

  } catch (error) {
    console.error('[Kamar] ❌ Error updateStatusKamar:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengubah status kamar.',
      error: error.message
    });
  }
};
