const express = require('express');
const router = express.Router();
const kosController = require('../controller/kos.controller');
const upload = require('../config/multer');
const { verifyToken, checkRole, checkWilayah } = require('../middleware/authJWT');
const db = require('../config/db');


/**
 * GET /api/kos
 * Daftar kos terverifikasi (PUBLIC)
 */
router.get('/', kosController.getKosList);


/**
 * GET /api/kos/admin/all
 * Get SEMUA kos dengan detail lengkap (foto, dokumen, fasilitas) - ADMIN ONLY
 */
router.get('/admin/all',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  checkWilayah,
  kosController.getAllKosForAdmin
);


/**
 * GET /api/kos/owner/dashboard
 * Get data dashboard pemilik kos (pemilikKos)
 */
router.get('/owner/dashboard',
  verifyToken,
  checkRole('pemilikKos'),
  kosController.getOwnerDashboardData
);

/**
 * GET /api/kos/owner/arus-kas
 * Get laporan arus kas pemilik kos
 */
router.get('/owner/arus-kas',
  verifyToken,
  checkRole('pemilikKos'),
  kosController.getOwnerArusKas
);

/**
 * POST /api/kos/owner/checkout-penghuni
 * Checkout penghuni kos sebelum masa sewa berakhir
 */
router.post('/owner/checkout-penghuni',
  verifyToken,
  checkRole('pemilikKos'),
  kosController.ownerCheckoutPenghuni
);


/**
 * GET /api/kos/:id/detail
 * Get detail lengkap 1 kos (untuk modal detail) - ADMIN/USER
 */
router.get('/:id/detail',
  verifyToken,
  kosController.getKosDetailById
);


/**
 * GET /api/kos/:id/audit-logs
 * Get audit logs untuk kos tertentu - ADMIN ONLY
 */
router.get('/:id/audit-logs', verifyToken, async (req, res) => {
  const { id } = req.params;

  try {
    const [logs] = await db.query(
      `SELECT 
        kal.id,
        kal.action,
        kal.field_changed,
        kal.old_value,
        kal.new_value,
        kal.changed_at,
        u.name as user_name,
        u.role as user_role
       FROM kos_audit_log kal
       LEFT JOIN users u ON kal.user_id = u.id
       WHERE kal.kos_id = ?
       ORDER BY kal.changed_at DESC
       LIMIT 50`,
      [id]
    );

    // Group logs by changed_at timestamp (untuk group multiple field changes)
    const groupedLogs = logs.reduce((acc, log) => {
      const timestamp = new Date(log.changed_at).getTime();
      if (!acc[timestamp]) {
        acc[timestamp] = {
          id: log.id,
          action: log.action,
          changes: [],
          changed_at: log.changed_at,
          user_name: log.user_name,
          user_role: log.user_role
        };
      }

      acc[timestamp].changes.push({
        field: log.field_changed,
        old: log.old_value,
        new: log.new_value
      });

      return acc;
    }, {});

    // Convert to array and format description
    const formattedLogs = Object.values(groupedLogs).map(log => ({
      ...log,
      description: log.changes.map(c => `${c.field}: ${c.old} → ${c.new}`).join(', ')
    }));

    res.json({
      success: true,
      logs: formattedLogs
    });

  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ message: 'Gagal mengambil audit logs' });
  }
});


/**
 * PUT /api/kos/:id
 * Update data kos (untuk kos yang sudah terverifikasi) - ADMIN ONLY
 */
router.put('/:id',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  kosController.updateKosData
);


/**
 * PATCH /api/kos/:id/update
 * Update kos data sederhana (tanpa foto) - ADMIN ONLY
 */
router.patch('/:id/update', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { jumlah_kamar, harga_sewa, deskripsi, peraturan, fasilitas } = req.body;

  try {
    if (!['super_admin', 'admin_desa', 'admin_banjar'].includes(req.user.role)) {
      return res.status(403).json({ message: 'Akses ditolak' });
    }

    const [oldData] = await db.query('SELECT * FROM kos WHERE id = ?', [id]);
    if (oldData.length === 0) {
      return res.status(404).json({ message: 'Kos tidak ditemukan' });
    }

    const old = oldData[0];

    await db.query(
      `UPDATE kos 
       SET jumlah_kamar = ?, harga_sewa = ?, deskripsi = ?, peraturan = ?, updated_at = NOW()
       WHERE id = ?`,
      [jumlah_kamar, harga_sewa, deskripsi, peraturan, id]
    );

    if (fasilitas && Array.isArray(fasilitas)) {
      await db.query('DELETE FROM kos_fasilitas WHERE kos_id = ?', [id]);

      if (fasilitas.length > 0) {
        const fasilitasValues = fasilitas.map(fasId => [id, fasId]);
        await db.query(
          'INSERT INTO kos_fasilitas (kos_id, fasilitas_id) VALUES ?',
          [fasilitasValues]
        );
      }
    }

    // ✅ PROPER: Insert per-field audit logs
    const auditPromises = [];

    if (old.jumlah_kamar !== jumlah_kamar) {
      auditPromises.push(
        db.query(
          `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
           VALUES (?, ?, 'update', 'Jumlah Kamar', ?, ?, NOW())`,
          [id, req.user.id, old.jumlah_kamar.toString(), jumlah_kamar.toString()]
        )
      );
    }

    if (old.harga_sewa !== harga_sewa) {
      auditPromises.push(
        db.query(
          `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
           VALUES (?, ?, 'update', 'Harga Sewa', ?, ?, NOW())`,
          [id, req.user.id, `Rp ${old.harga_sewa.toLocaleString('id-ID')}`, `Rp ${harga_sewa.toLocaleString('id-ID')}`]
        )
      );
    }

    if (old.deskripsi !== deskripsi) {
      auditPromises.push(
        db.query(
          `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
           VALUES (?, ?, 'update', 'Deskripsi', ?, ?, NOW())`,
          [id, req.user.id, old.deskripsi.substring(0, 50) + '...', deskripsi.substring(0, 50) + '...']
        )
      );
    }

    if (old.peraturan !== peraturan) {
      auditPromises.push(
        db.query(
          `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
           VALUES (?, ?, 'update', 'Peraturan', ?, ?, NOW())`,
          [id, req.user.id, old.peraturan.substring(0, 50) + '...', peraturan.substring(0, 50) + '...']
        )
      );
    }

    await Promise.all(auditPromises);

    res.json({
      success: true,
      message: 'Data kos berhasil diperbarui'
    });

  } catch (error) {
    console.error('Error updating kos:', error);
    res.status(500).json({ message: 'Terjadi kesalahan saat memperbarui data kos' });
  }
});


/**
 * ✅ PROPER FIX: PATCH /api/kos/:id/update-full
 * Update FULL data kos termasuk foto - ADMIN ONLY
 * Audit log uses: field_changed, old_value, new_value (NOT description)
 */
router.patch('/:id/update-full', 
  verifyToken,
  upload.fields([
    { name: 'fotoKos', maxCount: 10 }
  ]),
  async (req, res) => {
    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const { id } = req.params;
      const { 
        nama_kos, tipe_kos, alamat_lengkap, jumlah_kamar, harga_sewa,
        deskripsi, peraturan, fasilitas, deletePhotos, primaryPhotoId
      } = req.body;

      console.log('===== UPDATE FULL KOS DEBUG =====');
      console.log('Kos ID:', id);
      console.log('User:', req.user?.id, req.user?.role);

      // Validasi role
      if (!['super_admin', 'admin_desa', 'admin_banjar'].includes(req.user.role)) {
        await connection.rollback();
        return res.status(403).json({ success: false, message: 'Akses ditolak' });
      }

      // Validasi required fields
      if (!nama_kos || !tipe_kos || !alamat_lengkap || !jumlah_kamar || !harga_sewa || !deskripsi) {
        await connection.rollback();
        return res.status(400).json({ 
          success: false,
          message: 'Semua field wajib harus diisi'
        });
      }

      // Get old data
      const [oldData] = await connection.query('SELECT * FROM kos WHERE id = ?', [id]);
      if (oldData.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: 'Kos tidak ditemukan' });
      }

      const old = oldData[0];
      console.log('Old data:', { nama_kos: old.nama_kos, tipe_kos: old.tipe_kos, harga_sewa: old.harga_sewa });

      // Update kos table
      console.log('Updating kos table...');
      await connection.query(
        `UPDATE kos 
         SET nama_kos = ?, tipe_kos = ?, alamat_lengkap = ?, 
             jumlah_kamar = ?, harga_sewa = ?, deskripsi = ?, peraturan = ?, 
             updated_at = NOW()
         WHERE id = ?`,
        [nama_kos, tipe_kos, alamat_lengkap, parseInt(jumlah_kamar), parseInt(harga_sewa), deskripsi, peraturan || '', id]
      );
      console.log('✅ Kos table updated');

      // Update fasilitas
      if (fasilitas) {
        console.log('Updating fasilitas...');
        const fasilitasArray = JSON.parse(fasilitas);
        await connection.query('DELETE FROM kos_fasilitas WHERE kos_id = ?', [id]);

        if (fasilitasArray.length > 0) {
          const fasilitasValues = fasilitasArray.map(fasId => [id, parseInt(fasId)]);
          await connection.query('INSERT INTO kos_fasilitas (kos_id, fasilitas_id) VALUES ?', [fasilitasValues]);
          console.log(`✅ ${fasilitasArray.length} fasilitas updated`);
        }
      }

      // Delete foto lama
      if (deletePhotos) {
        const photosToDelete = JSON.parse(deletePhotos);
        if (photosToDelete.length > 0) {
          await connection.query('DELETE FROM kos_foto WHERE id IN (?)', [photosToDelete]);
          console.log(`✅ ${photosToDelete.length} photos deleted`);
        }
      }

      // Upload foto baru
      const newPhotos = req.files['fotoKos'] || [];
      if (newPhotos.length > 0) {
        console.log(`Uploading ${newPhotos.length} new photos...`);
        const [maxUrutan] = await connection.query(
          'SELECT COALESCE(MAX(urutan), 0) as max_urutan FROM kos_foto WHERE kos_id = ?', [id]
        );
        let currentUrutan = maxUrutan[0].max_urutan;

        for (const foto of newPhotos) {
          currentUrutan++;
          const fotoPath = `/uploads/${foto.filename}`;
          await connection.query(
            `INSERT INTO kos_foto (kos_id, file_name, file_path, mime_type, file_size, is_primary, urutan, created_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, NOW())`,
            [id, foto.filename, fotoPath, foto.mimetype, foto.size, currentUrutan]
          );
        }
        console.log(`✅ ${newPhotos.length} photos uploaded`);
      }

      // Update primary photo
      if (primaryPhotoId) {
        await connection.query('UPDATE kos_foto SET is_primary = 0 WHERE kos_id = ?', [id]);
        await connection.query(
          'UPDATE kos_foto SET is_primary = 1 WHERE id = ? AND kos_id = ?',
          [parseInt(primaryPhotoId), id]
        );
        console.log('✅ Primary photo set');
      }

      // ✅ PROPER: Create per-field audit logs
      console.log('Creating audit logs...');
      const auditPromises = [];

      if (old.nama_kos !== nama_kos) {
        auditPromises.push(
          connection.query(
            `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
             VALUES (?, ?, 'update', 'Nama Kos', ?, ?, NOW())`,
            [id, req.user.id, old.nama_kos, nama_kos]
          )
        );
      }

      if (old.tipe_kos !== tipe_kos) {
        auditPromises.push(
          connection.query(
            `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
             VALUES (?, ?, 'update', 'Tipe Kos', ?, ?, NOW())`,
            [id, req.user.id, old.tipe_kos, tipe_kos]
          )
        );
      }

      if (old.alamat_lengkap !== alamat_lengkap) {
        auditPromises.push(
          connection.query(
            `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
             VALUES (?, ?, 'update', 'Alamat', ?, ?, NOW())`,
            [id, req.user.id, old.alamat_lengkap.substring(0, 50) + '...', alamat_lengkap.substring(0, 50) + '...']
          )
        );
      }

      if (old.jumlah_kamar !== parseInt(jumlah_kamar)) {
        auditPromises.push(
          connection.query(
            `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
             VALUES (?, ?, 'update', 'Jumlah Kamar', ?, ?, NOW())`,
            [id, req.user.id, old.jumlah_kamar.toString(), jumlah_kamar.toString()]
          )
        );
      }

      if (old.harga_sewa !== parseInt(harga_sewa)) {
        auditPromises.push(
          connection.query(
            `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
             VALUES (?, ?, 'update', 'Harga Sewa', ?, ?, NOW())`,
            [id, req.user.id, `Rp ${old.harga_sewa.toLocaleString('id-ID')}`, `Rp ${parseInt(harga_sewa).toLocaleString('id-ID')}`]
          )
        );
      }

      if (old.deskripsi !== deskripsi) {
        auditPromises.push(
          connection.query(
            `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
             VALUES (?, ?, 'update', 'Deskripsi', 'Deskripsi diperbarui', 'Deskripsi baru', NOW())`,
            [id, req.user.id]
          )
        );
      }

      if (old.peraturan !== (peraturan || '')) {
        auditPromises.push(
          connection.query(
            `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
             VALUES (?, ?, 'update', 'Peraturan', 'Peraturan diperbarui', 'Peraturan baru', NOW())`,
            [id, req.user.id]
          )
        );
      }

      if (newPhotos.length > 0) {
        auditPromises.push(
          connection.query(
            `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
             VALUES (?, ?, 'update', 'Foto Kos', '-', ?, NOW())`,
            [id, req.user.id, `${newPhotos.length} foto ditambahkan`]
          )
        );
      }

      if (deletePhotos) {
        const deleted = JSON.parse(deletePhotos);
        if (deleted.length > 0) {
          auditPromises.push(
            connection.query(
              `INSERT INTO kos_audit_log (kos_id, user_id, action, field_changed, old_value, new_value, changed_at) 
               VALUES (?, ?, 'update', 'Foto Kos', ?, '-', NOW())`,
              [id, req.user.id, `${deleted.length} foto dihapus`]
            )
          );
        }
      }

      await Promise.all(auditPromises);
      console.log(`✅ ${auditPromises.length} audit logs created`);

      await connection.commit();
      console.log('===== UPDATE SUCCESS =====');

      res.json({ success: true, message: 'Data kos berhasil diperbarui' });

    } catch (error) {
      await connection.rollback();
      console.error('===== UPDATE ERROR =====');
      console.error('Error:', error);
      res.status(500).json({ 
        success: false,
        message: 'Terjadi kesalahan saat memperbarui data kos',
        error: error.message
      });
    } finally {
      connection.release();
    }
  }
);


/**
 * ✅ PATCH /api/kos/:id/update-owner
 * Update kos sebagai OWNER (pemilikKos) - OWNER ONLY
 */
router.patch('/:id/update-owner',
  verifyToken,
  checkRole('pemilikKos'),
  upload.fields([{ name: 'fotoKos', maxCount: 10 }]),
  kosController.updateKosAsOwner
);


/**
 * PATCH /api/kos/:id/deactivate
 * Nonaktifkan kos (soft delete) - ADMIN ONLY
 */
router.patch('/:id/deactivate',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  kosController.deactivateKos
);


/**
 * PATCH /api/kos/:id/verifikasi
 * Verifikasi kos (setujui/tolak) - ADMIN ONLY
 */
router.patch('/:id/verifikasi',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  kosController.verifikasiKos
);


/**
 * POST /api/kos/pengajuan
 * Submit pengajuan kos dengan upload file - USER
 */
router.post('/pengajuan', 
  verifyToken,
  checkRole('user','pemilikKos'),
  upload.fields([
    { name: 'fotoKTP', maxCount: 1 },
    { name: 'suratIzinBanjar', maxCount: 1 },
    { name: 'fotoKos', maxCount: 10 }
  ]),
  kosController.submitPengajuan
);


/**
 * GET /api/kos/lokasi/desa-adat
 */
router.get('/lokasi/desa-adat', async (req, res) => {
  try {
    const { kecamatanIdApi } = req.query;
    if (!kecamatanIdApi) {
      return res.status(400).json({ success: false, message: 'Parameter kecamatanIdApi diperlukan' });
    }
    const [rows] = await db.query('SELECT id, nama FROM desa_adat WHERE kecamatan_id_api = ? ORDER BY nama', [kecamatanIdApi]);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching desa adat:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat desa adat', error: error.message });
  }
});


/**
 * GET /api/kos/lokasi/banjar-adat
 */
router.get('/lokasi/banjar-adat', async (req, res) => {
  try {
    const { desaAdatId } = req.query;
    if (!desaAdatId) {
      return res.status(400).json({ success: false, message: 'Parameter desaAdatId diperlukan' });
    }
    const [rows] = await db.query('SELECT id, nama FROM banjar_adat WHERE desa_adat_id = ? ORDER BY nama', [desaAdatId]);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('Error fetching banjar adat:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat banjar adat', error: error.message });
  }
});


/**
 * GET /api/kos/:id/delete-info
 * Get informasi kos untuk konfirmasi delete - ADMIN ONLY
 */
router.get('/:id/delete-info',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  kosController.getKosDeleteInfo
);


/**
 * DELETE /api/kos/:id
 * Soft delete kos - ADMIN ONLY
 */
router.delete('/:id',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  kosController.deleteKos
);


/**
 * GET /api/kos/admin/stats
 * Ambil data statistik untuk admin dashboard
 */
router.get('/admin/stats',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  checkWilayah,
  kosController.getAdminDashboardStats
);

/**
 * GET /api/kos/admin/kos-aktif
 * Ambil daftar kos aktif wilayah adat
 */
router.get('/admin/kos-aktif',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  checkWilayah,
  kosController.getAdminKosAktifList
);

/**
 * GET /api/kos/admin/transaksi
 * Ambil daftar riwayat transaksi terbaru wilayah adat
 */
router.get('/admin/transaksi',
  verifyToken,
  checkRole('super_admin', 'admin_desa', 'admin_banjar'),
  checkWilayah,
  kosController.getAdminTransactionHistory
);


module.exports = router;
