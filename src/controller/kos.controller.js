const db = require('../config/db');
const { formatFileUrl, formatFilesArray } = require('../helpers/fileHelper');
const { saveAuditLog, getKosAuditLogs, formatAuditLogs } = require('../helpers/auditLog.helper');

// ==================== SUBMIT PENGAJUAN ====================
exports.submitPengajuan = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const {
      namaKos, tipeKos, jumlahKamar, hargaSewa, alamatLengkap,
      kabupaten_id_api, kecamatan_id_api, desa_adat_id, banjar_adat_id,
      kodePos, fasilitas, fasilitasLainnya, namaPemilik, nomorHP, email,
      deskripsi, peraturan, tipeKamarList
    } = req.body;

    const fotoKTP = req.files?.fotoKTP?.[0] || null;
    const suratIzinBanjar = req.files?.suratIzinBanjar?.[0] || null;
    const fotoKos = req.files?.fotoKos || [];

    // Validasi wajib
    if (!namaKos || !tipeKos || !jumlahKamar || !hargaSewa || !alamatLengkap || 
        !banjar_adat_id || !namaPemilik || !nomorHP) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false,
        message: 'Data wajib tidak lengkap' 
      });
    }

    if (!fotoKTP || !suratIzinBanjar) {
      await connection.rollback();
      return res.status(400).json({ 
        success: false,
        message: 'KTP dan Surat Izin Banjar wajib diunggah' 
      });
    }

    // ✅ FIXED: Insert kos dengan created_by
    const [resultKos] = await connection.query(
      `INSERT INTO kos (
        created_by, nama_kos, tipe_kos, jumlah_kamar, harga_sewa, alamat_lengkap,
        kabupaten_id_api, kecamatan_id_api, desa_adat_id, banjar_adat_id,
        kode_pos, deskripsi, peraturan, nama_pemilik, nomor_hp, email,
        status_verifikasi, status_aktif, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'aktif', NOW())`,
      [
        req.user.id,  // ✅ User ID yang mengajukan
        namaKos, tipeKos, jumlahKamar, hargaSewa, alamatLengkap,
        kabupaten_id_api, kecamatan_id_api, desa_adat_id, banjar_adat_id,
        kodePos || null, deskripsi || null, peraturan || null,
        namaPemilik, nomorHP, email || null
      ]
    );

    const kosId = resultKos.insertId;

    // Parse tipeKamarList
    let tipeKamarArray = [];
    if (tipeKamarList) {
      try {
        tipeKamarArray = typeof tipeKamarList === 'string' ? JSON.parse(tipeKamarList) : tipeKamarList;
      } catch (e) {
        console.error('Error parsing tipeKamarList:', e);
      }
    }

    // Fallback default type for backward compatibility
    if (tipeKamarArray.length === 0) {
      tipeKamarArray = [{
        nama_tipe: 'Standar',
        harga_kamar: hargaSewa || 0,
        fasilitas: null,
        jumlah_kamar: jumlahKamar || 0
      }];
    }

    // Save room types & auto-generate physical rooms
    let physicalRoomNumber = 1;
    for (const tipe of tipeKamarArray) {
      const [tipeResult] = await connection.query(
        `INSERT INTO kamar_tipe (id_kos, nama_tipe, harga_kamar, fasilitas) VALUES (?, ?, ?, ?)`,
        [kosId, tipe.nama_tipe || 'Standar', tipe.harga_kamar || 0, tipe.fasilitas || null]
      );
      const idTipe = tipeResult.insertId;

      const roomCount = parseInt(tipe.jumlah_kamar) || 0;
      if (roomCount > 0) {
        const roomValues = [];
        for (let i = 0; i < roomCount; i++) {
          roomValues.push([idTipe, String(physicalRoomNumber++), 'tersedia']);
        }
        await connection.query(
          `INSERT INTO kamar_fisik (id_tipe, nomor_kamar, status_ketersediaan) VALUES ?`,
          [roomValues]
        );
      }
    }

    // Insert fasilitas
    if (fasilitas) {
      const fasilitasArray = JSON.parse(fasilitas);
      if (fasilitasArray.length > 0 && Array.isArray(fasilitasArray)) {
        const fasilitasValues = fasilitasArray.map(fId => [kosId, fId]);
        await connection.query(
          'INSERT INTO kos_fasilitas (kos_id, fasilitas_id) VALUES ?',
          [fasilitasValues]
        );
      }
    }

    // Insert dokumen KTP
    const ktpPath = `/uploads/${fotoKTP.filename}`;
    await connection.query(
      `INSERT INTO kos_dokumen (kos_id, jenis, file_name, file_path, mime_type, file_size, created_at)
       VALUES (?, 'KTP', ?, ?, ?, ?, NOW())`,
      [kosId, fotoKTP.filename, ktpPath, fotoKTP.mimetype, fotoKTP.size]
    );

    // Insert dokumen Surat Izin Banjar
    const suratPath = `/uploads/${suratIzinBanjar.filename}`;
    await connection.query(
      `INSERT INTO kos_dokumen (kos_id, jenis, file_name, file_path, mime_type, file_size, created_at)
       VALUES (?, 'SURAT_IZIN_BANJAR', ?, ?, ?, ?, NOW())`,
      [kosId, suratIzinBanjar.filename, suratPath, suratIzinBanjar.mimetype, suratIzinBanjar.size]
    );

    // Insert foto kos (foto pertama = primary)
    if (fotoKos.length > 0) {
      for (let i = 0; i < fotoKos.length; i++) {
        const foto = fotoKos[i];
        const fotoPath = `/uploads/${foto.filename}`;
        const isPrimary = i === 0 ? 1 : 0;

        await connection.query(
          `INSERT INTO kos_foto (kos_id, file_name, file_path, mime_type, file_size, is_primary, urutan, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
          [kosId, foto.filename, fotoPath, foto.mimetype, foto.size, isPrimary, i + 1]
        );
      }
    }

    await connection.commit();

    // Save audit log (async, tidak block response)
    saveAuditLog({
      kos_id: kosId,
      user_id: req.user?.id || null,
      action: 'create'
    });

    res.status(201).json({
      success: true,
      message: 'Pengajuan kos berhasil dikirim. Menunggu verifikasi admin.',
      data: { kosId }
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error submitPengajuan:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengirim pengajuan',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// ==================== GET KOS LIST (PUBLIC) ====================
exports.getKosList = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT 
        k.id, k.nama_kos AS nama, k.tipe_kos, k.jumlah_kamar, k.harga_sewa,
        k.alamat_lengkap, k.deskripsi, k.status_verifikasi,
        k.kabupaten_id_api, k.kecamatan_id_api, k.desa_adat_id, k.banjar_adat_id,
        b.nama AS banjar_adat,
        d.nama AS desa_adat,
        (SELECT file_path FROM kos_foto WHERE kos_id = k.id AND is_primary = 1 LIMIT 1) AS foto_utama
       FROM kos k
       LEFT JOIN banjar_adat b ON b.id = k.banjar_adat_id
       LEFT JOIN desa_adat d ON d.id = k.desa_adat_id
       WHERE k.status_verifikasi = 'terverifikasi' 
       AND k.status_aktif = 'aktif'
       AND k.deleted_at IS NULL
       ORDER BY k.created_at DESC`
    );

    // Ambil fasilitas per kos
    for (let kos of rows) {
      const [fasilitas] = await db.query(
        `SELECT f.id, f.nama 
         FROM kos_fasilitas kf
         JOIN fasilitas_master f ON f.id = kf.fasilitas_id
         WHERE kf.kos_id = ?
         ORDER BY f.id`,
        [kos.id]
      );

      kos.fasilitas = fasilitas.map(f => f.nama);
      kos.gambar = formatFileUrl(kos.foto_utama) || 'https://via.placeholder.com/400x300?text=Foto+Tidak+Tersedia';
      kos.tipe = kos.tipe_kos;
      kos.alamat = kos.alamat_lengkap;
      kos.harga = kos.harga_sewa;
      kos.tersedia = kos.jumlah_kamar;
    }

    res.json({
      success: true,
      data: rows,
      total: rows.length
    });
  } catch (error) {
    console.error('Error getKosList:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil daftar kos',
      error: error.message
    });
  }
};

// ==================== GET ALL KOS FOR ADMIN (WITH DETAILS) ====================
exports.getAllKosForAdmin = async (req, res) => {
  try {
    const user = req.user;
    const wilayahFilter = req.wilayahFilter || {};

    // Build WHERE clause berdasarkan role admin
    let whereConditions = ['k.deleted_at IS NULL'];
    let queryParams = [];

    if (wilayahFilter.desa_adat_id) {
      whereConditions.push('k.desa_adat_id = ?');
      queryParams.push(wilayahFilter.desa_adat_id);
    }

    if (wilayahFilter.banjar_adat_id) {
      whereConditions.push('k.banjar_adat_id = ?');
      queryParams.push(wilayahFilter.banjar_adat_id);
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    // Query kos dengan prioritas pending di atas
    const query = `
      SELECT 
        k.id as kos_id,
        k.nama_kos,
        k.tipe_kos,
        k.alamat_lengkap,
        k.jumlah_kamar,
        k.status_verifikasi,
        k.status_aktif,
        k.created_at,
        k.updated_at,
        k.deskripsi,
        k.peraturan,
        k.nomor_hp as kontak,
        k.nama_pemilik,
        k.email as email_pemilik,
        k.alasan_penolakan,
        ba.nama as nama_banjar,
        da.nama as nama_desa_adat
      FROM kos k
      LEFT JOIN banjar_adat ba ON k.banjar_adat_id = ba.id
      LEFT JOIN desa_adat da ON k.desa_adat_id = da.id
      ${whereClause}
      ORDER BY 
        CASE k.status_verifikasi
          WHEN 'pending' THEN 1
          WHEN 'terverifikasi' THEN 2
          WHEN 'ditolak' THEN 3
        END,
        k.created_at DESC
    `;

    const [results] = await db.query(query, queryParams);

    // Loop per kos: ambil foto, dokumen, fasilitas
    for (let kos of results) {
      // 1. Foto kos
      const [fotoRows] = await db.query(
        `SELECT id, file_name, file_path, mime_type, is_primary, urutan
         FROM kos_foto
         WHERE kos_id = ?
         ORDER BY is_primary DESC, urutan`,
        [kos.kos_id]
      );
      kos.foto_kos = formatFilesArray(fotoRows);

      // 2. Dokumen (KTP, Surat Izin)
      const [dokumenRows] = await db.query(
        `SELECT id, jenis, file_name, file_path, mime_type, file_size
         FROM kos_dokumen
         WHERE kos_id = ?
         ORDER BY jenis`,
        [kos.kos_id]
      );
      kos.dokumen = formatFilesArray(dokumenRows);

      // 3. Fasilitas (nama + IDs untuk edit modal)
      const [fasilitasRows] = await db.query(
        `SELECT f.id, f.nama
         FROM kos_fasilitas kf
         JOIN fasilitas_master f ON kf.fasilitas_id = f.id
         WHERE kf.kos_id = ?
         ORDER BY f.id`,
        [kos.kos_id]
      );
      kos.fasilitas = fasilitasRows.map(f => f.nama);
      kos.fasilitas_ids = fasilitasRows.map(f => f.id);
    }

    // Transform untuk frontend
    const kosData = results.map(k => ({
      kos_id: k.kos_id,
      nama_kos: k.nama_kos,
      tipe_kos: k.tipe_kos,
      alamat_lengkap: k.alamat_lengkap,
      jumlah_kamar: k.jumlah_kamar,
      status_verifikasi: k.status_verifikasi,
      status_aktif: k.status_aktif,
      tanggal_pengajuan: k.created_at,
      tanggal_verifikasi: k.updated_at,
      alasan_penolakan: k.alasan_penolakan,
      deskripsi: k.deskripsi,
      peraturan: k.peraturan,
      kontak: k.kontak,
      nama_pemilik: k.nama_pemilik,
      email_pemilik: k.email_pemilik,
      nama_banjar: k.nama_banjar,
      nama_desa_adat: k.nama_desa_adat,
      foto_kos: k.foto_kos,
      dokumen: k.dokumen,
      fasilitas: k.fasilitas,
      fasilitas_ids: k.fasilitas_ids
    }));

    res.json({
      success: true,
      kos: kosData
    });

  } catch (error) {
    console.error('Error getAllKosForAdmin:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data kos',
      error: error.message
    });
  }
};

// ==================== VERIFIKASI KOS ====================
exports.verifikasiKos = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const { id } = req.params;
    const { status, alasan_penolakan } = req.body;
    const user = req.user;

    // Validasi status
    if (!['terverifikasi', 'ditolak'].includes(status)) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Status tidak valid. Harus "terverifikasi" atau "ditolak"'
      });
    }

    // Validasi alasan penolakan wajib jika ditolak
    if (status === 'ditolak' && !alasan_penolakan) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Alasan penolakan harus diisi'
      });
    }

    // Cek kos exists dan not deleted
    const [kos] = await connection.query(
      'SELECT * FROM kos WHERE id = ? AND deleted_at IS NULL',
      [id]
    );

    if (kos.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Kos tidak ditemukan atau sudah dihapus'
      });
    }

    const kosData = kos[0];

    // Validasi wilayah admin
    if (user.role === 'admin_desa') {
      if (kosData.desa_adat_id !== user.desa_adat_id) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: 'Anda hanya bisa memverifikasi kos di desa adat Anda'
        });
      }
    }

    if (user.role === 'admin_banjar') {
      if (kosData.banjar_adat_id !== user.banjar_adat_id) {
        await connection.rollback();
        return res.status(403).json({
          success: false,
          message: 'Anda hanya bisa memverifikasi kos di banjar adat Anda'
        });
      }
    }

    // Update status kos
    await connection.query(
      `UPDATE kos
       SET status_verifikasi = ?,
           alasan_penolakan = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [status, status === 'ditolak' ? alasan_penolakan : null, id]
    );

    // ✅ FITUR BARU: Auto-update role user jadi 'pemilikKos' jika approved
    if (status === 'terverifikasi' && kosData.created_by) {
      const [updateResult] = await connection.query(
        `UPDATE users 
         SET role = 'pemilikKos'
         WHERE id = ? AND role = 'user'`,
        [kosData.created_by]
      );
      
      if (updateResult.affectedRows > 0) {
        console.log(`✅ User ID ${kosData.created_by} role upgraded to 'pemilikKos'`);
      } else {
        console.log(`ℹ️ User ID ${kosData.created_by} role already 'pemilikKos' or not found`);
      }
    }

    // Save audit log
    saveAuditLog({
      kos_id: id,
      user_id: user.id,
      action: status === 'terverifikasi' ? 'verify' : 'reject',
      field_changed: 'status_verifikasi',
      old_value: kosData.status_verifikasi,
      new_value: status
    });

    await connection.commit();

    saveAuditLog({
      kos_id: id,
      user_id: user.id,
      action: status === 'terverifikasi' ? 'verify' : 'reject',
      field_changed: 'status_verifikasi',
      old_value: kosData.status_verifikasi,
      new_value: status
    });

    res.json({
      success: true,
      message: `Kos berhasil ${status === 'terverifikasi' ? 'disetujui' : 'ditolak'}${
        status === 'terverifikasi' ? '. User telah menjadi Pemilik Kos.' : ''
      }`
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error verifikasiKos:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal verifikasi kos',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// ==================== GET KOS DETAIL BY ID ====================
exports.getKosDetailById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    // Query kos utama (check not deleted)
    const [kosRows] = await db.query(
      `SELECT 
        k.*,
        ba.nama as nama_banjar,
        da.nama as nama_desa_adat
       FROM kos k
       LEFT JOIN banjar_adat ba ON k.banjar_adat_id = ba.id
       LEFT JOIN desa_adat da ON k.desa_adat_id = da.id
       WHERE k.id = ? AND k.deleted_at IS NULL`,
      [id]
    );

    if (kosRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kos tidak ditemukan atau sudah dihapus'
      });
    }

    const kos = kosRows[0];

    // Ambil foto
    const [fotoRows] = await db.query(
      `SELECT * FROM kos_foto WHERE kos_id = ? ORDER BY is_primary DESC, urutan`,
      [id]
    );
    kos.foto_kos = formatFilesArray(fotoRows);

    // Ambil dokumen
    const [dokumenRows] = await db.query(
      `SELECT * FROM kos_dokumen WHERE kos_id = ? ORDER BY jenis`,
      [id]
    );
    kos.dokumen = formatFilesArray(dokumenRows);

    // Ambil fasilitas
    const [fasilitasRows] = await db.query(
      `SELECT f.id, f.nama
       FROM kos_fasilitas kf
       JOIN fasilitas_master f ON kf.fasilitas_id = f.id
       WHERE kf.kos_id = ?
       ORDER BY f.id`,
      [id]
    );
    kos.fasilitas = fasilitasRows;

    // Ambil audit log (jika admin)
    if (user && ['super_admin', 'admin_desa', 'admin_banjar'].includes(user.role)) {
      const logs = await getKosAuditLogs(id, 20);
      kos.audit_logs = formatAuditLogs(logs);
    }

    res.json({
      success: true,
      data: kos
    });

  } catch (error) {
    console.error('Error getKosDetailById:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil detail kos',
      error: error.message
    });
  }
};

// ==================== UPDATE KOS DATA ====================
exports.updateKosData = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const user = req.user;
    const { jumlah_kamar, harga_sewa, deskripsi, peraturan, fasilitas } = req.body;

    // Cek kos exists dan not deleted
    const [kosRows] = await connection.query(
      'SELECT * FROM kos WHERE id = ? AND deleted_at IS NULL', 
      [id]
    );

    if (kosRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Kos tidak ditemukan atau sudah dihapus'
      });
    }

    const oldData = kosRows[0];

    // Build update query dinamis
    const updates = [];
    const params = [];

    if (jumlah_kamar !== undefined) {
      updates.push('jumlah_kamar = ?');
      params.push(jumlah_kamar);

      if (jumlah_kamar != oldData.jumlah_kamar) {
        await saveAuditLog({
          kos_id: id,
          user_id: user.id,
          action: 'update',
          field_changed: 'jumlah_kamar',
          old_value: String(oldData.jumlah_kamar),
          new_value: String(jumlah_kamar)
        });
      }
    }

    if (harga_sewa !== undefined) {
      updates.push('harga_sewa = ?');
      params.push(harga_sewa);

      if (harga_sewa != oldData.harga_sewa) {
        await saveAuditLog({
          kos_id: id,
          user_id: user.id,
          action: 'update',
          field_changed: 'harga_sewa',
          old_value: String(oldData.harga_sewa),
          new_value: String(harga_sewa)
        });
      }
    }

    if (deskripsi !== undefined) {
      updates.push('deskripsi = ?');
      params.push(deskripsi);
    }

    if (peraturan !== undefined) {
      updates.push('peraturan = ?');
      params.push(peraturan);
    }

    updates.push('updated_at = NOW()');
    params.push(id);

    if (updates.length > 1) {
      const updateQuery = `UPDATE kos SET ${updates.join(', ')} WHERE id = ?`;
      await connection.query(updateQuery, params);
    }

    // Update fasilitas
    if (fasilitas && Array.isArray(fasilitas)) {
      await connection.query('DELETE FROM kos_fasilitas WHERE kos_id = ?', [id]);

      if (fasilitas.length > 0) {
        const fasilitasValues = fasilitas.map(fId => [id, fId]);
        await connection.query(
          'INSERT INTO kos_fasilitas (kos_id, fasilitas_id) VALUES ?',
          [fasilitasValues]
        );
      }

      await saveAuditLog({
        kos_id: id,
        user_id: user.id,
        action: 'update',
        field_changed: 'fasilitas',
        old_value: 'Fasilitas lama',
        new_value: `${fasilitas.length} fasilitas baru`
      });
    }

    await connection.commit();

    res.json({
      success: true,
      message: 'Data kos berhasil diperbarui'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error updateKosData:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui data kos',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// ==================== DEACTIVATE KOS ====================
exports.deactivateKos = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const [kosRows] = await db.query(
      'SELECT * FROM kos WHERE id = ? AND deleted_at IS NULL', 
      [id]
    );

    if (kosRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kos tidak ditemukan atau sudah dihapus'
      });
    }

    const oldData = kosRows[0];

    await db.query(
      `UPDATE kos SET status_aktif = 'nonaktif', updated_at = NOW() WHERE id = ?`,
      [id]
    );

    await saveAuditLog({
      kos_id: id,
      user_id: user.id,
      action: 'deactivate',
      field_changed: 'status_aktif',
      old_value: oldData.status_aktif,
      new_value: 'nonaktif'
    });

    res.json({
      success: true,
      message: 'Kos berhasil dinonaktifkan'
    });

  } catch (error) {
    console.error('Error deactivateKos:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menonaktifkan kos',
      error: error.message
    });
  }
};

// ==================== GET KOS DELETE INFO ====================
exports.getKosDeleteInfo = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!['super_admin', 'admin_desa', 'admin_banjar'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin yang dapat menghapus kos'
      });
    }

    const [kosRows] = await db.query(
      `SELECT 
        k.id, k.nama_kos, k.alamat_lengkap, k.jumlah_kamar,
        k.status_aktif, k.deleted_at, k.desa_adat_id, k.banjar_adat_id,
        ba.nama as nama_banjar,
        da.nama as nama_desa_adat
      FROM kos k
      LEFT JOIN banjar_adat ba ON k.banjar_adat_id = ba.id
      LEFT JOIN desa_adat da ON k.desa_adat_id = da.id
      WHERE k.id = ?`,
      [id]
    );

    if (kosRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kos tidak ditemukan'
      });
    }

    const kos = kosRows[0];

    if (kos.deleted_at) {
      return res.status(400).json({
        success: false,
        message: 'Kos ini sudah dihapus sebelumnya'
      });
    }

    if (user.role === 'admin_desa' && kos.desa_adat_id !== user.desa_adat_id) {
      return res.status(403).json({
        success: false,
        message: 'Anda hanya bisa menghapus kos di desa adat Anda'
      });
    }

    if (user.role === 'admin_banjar' && kos.banjar_adat_id !== user.banjar_adat_id) {
      return res.status(403).json({
        success: false,
        message: 'Anda hanya bisa menghapus kos di banjar adat Anda'
      });
    }

    let penyewaAktif = [];
    try {
      const [penyewaRows] = await db.query(
        `SELECT 
          p.id, p.nama as nama_penyewa, p.tanggal_masuk,
          k.nomor_kamar
        FROM penyewa p
        JOIN kamar k ON p.kamar_id = k.id
        WHERE k.kos_id = ? AND p.status = 'aktif'
        ORDER BY k.nomor_kamar`,
        [id]
      );
      penyewaAktif = penyewaRows;
    } catch (error) {
      console.log('Tabel penyewa belum ada');
    }

    let jumlahKamarTotal = 0;
    try {
      const [kamarRows] = await db.query(
        'SELECT COUNT(*) as total FROM kamar WHERE kos_id = ?',
        [id]
      );
      jumlahKamarTotal = kamarRows[0].total;
    } catch (error) {
      jumlahKamarTotal = kos.jumlah_kamar;
    }

    res.json({
      success: true,
      data: {
        kos_id: kos.id,
        nama_kos: kos.nama_kos,
        alamat: kos.alamat_lengkap,
        nama_banjar: kos.nama_banjar,
        nama_desa_adat: kos.nama_desa_adat,
        jumlah_kamar: jumlahKamarTotal,
        penyewa_aktif: penyewaAktif,
        jumlah_penyewa_aktif: penyewaAktif.length
      }
    });

  } catch (error) {
    console.error('Error getKosDeleteInfo:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil informasi kos',
      error: error.message
    });
  }
};

// ==================== DELETE KOS ====================
exports.deleteKos = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const user = req.user;

    if (!['super_admin', 'admin_desa', 'admin_banjar'].includes(user.role)) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya admin yang dapat menghapus kos'
      });
    }

    const [kosRows] = await connection.query('SELECT * FROM kos WHERE id = ?', [id]);

    if (kosRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: 'Kos tidak ditemukan'
      });
    }

    const kos = kosRows[0];

    if (kos.deleted_at) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Kos ini sudah dihapus sebelumnya'
      });
    }

    if (user.role === 'admin_desa' && kos.desa_adat_id !== user.desa_adat_id) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: 'Anda hanya bisa menghapus kos di desa adat Anda'
      });
    }

    if (user.role === 'admin_banjar' && kos.banjar_adat_id !== user.banjar_adat_id) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: 'Anda hanya bisa menghapus kos di banjar adat Anda'
      });
    }

    await connection.query(
      `UPDATE kos 
       SET deleted_at = NOW(), deleted_by = ?
       WHERE id = ?`,
      [user.id, id]
    );

    try {
      await connection.query(
        `UPDATE kamar 
         SET status = 'unavailable' 
         WHERE kos_id = ?`,
        [id]
      );
    } catch (error) {
      console.log('Tabel kamar belum ada');
    }

    try {
      await connection.query(
        `UPDATE penyewa p
         JOIN kamar k ON p.kamar_id = k.id
         SET p.status = 'keluar',
             p.tanggal_keluar = NOW(),
             p.alasan_keluar = 'Kos dihapus oleh admin'
         WHERE k.kos_id = ? AND p.status = 'aktif'`,
        [id]
      );
    } catch (error) {
      console.log('Tabel penyewa belum ada');
    }

    await saveAuditLog({
      kos_id: id,
      user_id: user.id,
      action: 'delete',
      field_changed: 'status',
      old_value: 'active',
      new_value: 'deleted'
    });

    await connection.commit();

    res.json({
      success: true,
      message: 'Kos berhasil dihapus'
    });

  } catch (error) {
    await connection.rollback();
    console.error('Error deleteKos:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menghapus kos',
      error: error.message
    });
  } finally {
    connection.release();
  }
};

// ==================== GET KOS AUDIT LOGS ====================
exports.getKosAuditLogs = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    if (!['super_admin', 'admin_desa', 'admin_banjar'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak'
      });
    }

    const [kosRows] = await db.query('SELECT id FROM kos WHERE id = ?', [id]);

    if (kosRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kos tidak ditemukan'
      });
    }

    const logs = await getKosAuditLogs(id, 50);
    const formattedLogs = formatAuditLogs(logs);

    res.json({
      success: true,
      logs: formattedLogs
    });

  } catch (error) {
    console.error('Error getKosAuditLogs:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil audit logs',
      error: error.message
    });
  }
};

// backend/src/controller/kos.controller.js

// ==================== UPDATE KOS AS OWNER ====================
exports.updateKosAsOwner = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { id } = req.params;
    const userId = req.user.id;
    
    const {
      nama_kos, tipe_kos, alamat_lengkap, jumlah_kamar, harga_sewa,
      deskripsi, peraturan, fasilitas, deletePhotos, primaryPhotoId
    } = req.body;

    console.log('===== UPDATE KOS AS OWNER =====');
    console.log('Kos ID:', id);
    console.log('User ID:', userId);

    // ✅ VALIDASI: Cek apakah kos ini milik user
    const [kosRows] = await connection.query(
      'SELECT * FROM kos WHERE id = ? AND created_by = ? AND deleted_at IS NULL',
      [id, userId]
    );

    if (kosRows.length === 0) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: 'Anda hanya bisa mengupdate kos milik Anda sendiri'
      });
    }

    const oldData = kosRows[0];

    // ✅ VALIDASI: Kos harus sudah terverifikasi
    if (oldData.status_verifikasi !== 'terverifikasi') {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Hanya kos terverifikasi yang bisa diupdate'
      });
    }

    // Validasi required fields
    if (!nama_kos || !tipe_kos || !alamat_lengkap || !jumlah_kamar || !harga_sewa || !deskripsi) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: 'Semua field wajib harus diisi'
      });
    }

    console.log('Old data:', { nama_kos: oldData.nama_kos, harga_sewa: oldData.harga_sewa });

    // Update kos table
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

    // ✅ Create audit logs (async, tidak block)
    saveAuditLog({
      kos_id: id,
      user_id: userId,
      action: 'update',
      field_changed: 'data_kos',
      old_value: 'Data lama',
      new_value: 'Data diperbarui oleh pemilik'
    });

    await connection.commit();
    console.log('===== UPDATE SUCCESS =====');

    res.json({ 
      success: true, 
      message: 'Data kos berhasil diperbarui' 
    });

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
};

// ==================== GET OWNER DASHBOARD DATA ====================
exports.getOwnerDashboardData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { kosId } = req.query;

    console.log('===== GET OWNER DASHBOARD DATA =====');
    console.log('User ID:', userId);
    console.log('Query kosId:', kosId);

    // 1. Ambil semua kos milik owner ini untuk navigasi/dropdown properti
    const [kosRows] = await db.query(
      'SELECT id, nama_kos, jumlah_kamar, status_verifikasi FROM kos WHERE created_by = ? AND deleted_at IS NULL',
      [userId]
    );

    if (kosRows.length === 0) {
      return res.json({
        success: true,
        hasKos: false,
        stats: {
          totalPendapatan: 0,
          totalKamarTerisi: 0,
          totalKamarKosong: 0
        },
        tenants: [],
        kos: null,
        properties: []
      });
    }

    // Tentukan kos mana yang dipilih
    let selectedKos = null;
    if (kosId) {
      selectedKos = kosRows.find(k => k.id === parseInt(kosId));
    }
    
    // Jika tidak ditemukan atau tidak dikirim, default ke properti pertama
    if (!selectedKos) {
      selectedKos = kosRows[0];
    }

    const selectedKosId = selectedKos.id;
    console.log('Selected Kos ID:', selectedKosId);

    // Ambil data kos lengkap (untuk modal edit)
    const [fullKosRows] = await db.query(
      'SELECT * FROM kos WHERE id = ?',
      [selectedKosId]
    );
    const mainKos = fullKosRows[0];

    // B. Total Pendapatan untuk properti terpilih
    // Sum total_harga dari transaksi_sewa yang status_pembayaran = 'settlement'
    const [incomeResult] = await db.query(
      `SELECT SUM(total_harga) AS total_pendapatan 
       FROM transaksi_sewa 
       WHERE id_kos = ? AND status_pembayaran = 'settlement'`,
      [selectedKosId]
    );
    const totalPendapatan = parseInt(incomeResult[0].total_pendapatan || 0);

    // Hitung Total Pengeluaran (Iuran Desa yang Lunas) untuk kos terpilih
    // Iuran desa dihitung berdasarkan base nominal (id.nominal) dari tagihan yang status_pembayaran = 'lunas'
    // yang sesuai dengan desa_adat_id dari kos terpilih.
    const [expenseResult] = await db.query(
      `SELECT SUM(id.nominal) AS total_pengeluaran 
       FROM tagihan_pemilik tp
       JOIN iuran_desa id ON tp.iuran_id = id.id
       WHERE tp.pemilik_id = ? 
         AND id.desa_adat_id = ? 
         AND tp.status_pembayaran = 'lunas'`,
      [userId, mainKos.desa_adat_id]
    );
    const totalPengeluaran = parseInt(expenseResult[0].total_pengeluaran || 0);
    const keuntunganBersih = totalPendapatan - totalPengeluaran;

    // C. Total Kamar Terisi dan Kosong untuk properti terpilih langsung dari kamar_fisik (Source of Truth)
    // agar 100% selaras dengan grid denah kamar yang ditampilkan ke pemilik
    const [roomsStatsResult] = await db.query(
      `SELECT 
         SUM(CASE WHEN kf.status_ketersediaan = 'terisi' THEN 1 ELSE 0 END) AS total_terisi,
         SUM(CASE WHEN kf.status_ketersediaan = 'tersedia' THEN 1 ELSE 0 END) AS total_kosong
       FROM kamar_fisik kf
       JOIN kamar_tipe kt ON kf.id_tipe = kt.id
       WHERE kt.id_kos = ?`,
      [selectedKosId]
    );
    const totalKamarTerisi = parseInt(roomsStatsResult[0].total_terisi || 0);
    const totalKamarKosong = parseInt(roomsStatsResult[0].total_kosong || 0);

    // 2. Ambil daftar penghuni aktif untuk properti terpilih
    const [tenantRows] = await db.query(
      `SELECT 
        ts.id_sewa,
        ts.order_id,
        ts.id_user,
        ts.id_kos,
        ts.tanggal_mulai_sewa,
        ts.durasi_bulan,
        ts.total_harga,
        ts.status_sewa,
        ts.status_pembayaran,
        ts.created_at AS tanggal_transaksi,
        u.name AS nama_penyewa,
        u.email AS email_penyewa,
        u.no_hp AS hp_penyewa,
        k.nama_kos
       FROM transaksi_sewa ts
       JOIN users u ON ts.id_user = u.id
       JOIN kos k ON ts.id_kos = k.id
       WHERE ts.id_kos = ? 
       AND ts.status_sewa = 'aktif' 
       AND ts.status_pembayaran = 'settlement'
       ORDER BY ts.created_at DESC`,
      [selectedKosId]
    );

    // Ambil detail foto kos terpilih
    const [fotoRows] = await db.query(
      `SELECT id, file_name, file_path, mime_type, is_primary, urutan FROM kos_foto WHERE kos_id = ? ORDER BY is_primary DESC, urutan`,
      [selectedKosId]
    );
    mainKos.foto_kos = fotoRows;

    // Ambil detail fasilitas kos terpilih
    const [fasilitasRows] = await db.query(
      `SELECT f.id, f.nama
       FROM kos_fasilitas kf
       JOIN fasilitas_master f ON kf.fasilitas_id = f.id
       WHERE kf.kos_id = ?
       ORDER BY f.id`,
      [selectedKosId]
    );
    mainKos.fasilitas_ids = fasilitasRows.map(f => f.id);
    mainKos.fasilitas = fasilitasRows.map(f => f.nama);

    // D. Ambil detail kamar dan penghuni untuk properti terpilih
    const queryKamar = `
      SELECT 
        kt.id AS tipe_id,
        kt.nama_tipe,
        kt.harga_kamar,
        
        kf.id AS kamar_id,
        kf.nomor_kamar,
        kf.status_ketersediaan,
        
        pk.id_kipem,
        pk.tanggal_masuk,
        pk.tanggal_keluar,
        pk.id_user,
        u.name AS nama_penghuni,
        u.no_ktp AS nik_penghuni,
        u.no_hp AS no_hp_penghuni,
        u.email AS email_penghuni,
        
        ts.tanggal_mulai_sewa,
        ts.durasi_bulan
      FROM kamar_tipe kt
      LEFT JOIN kamar_fisik kf ON kt.id = kf.id_tipe
      LEFT JOIN penghuni_kipem pk ON kf.id = pk.id_kamar_fisik AND pk.status_kipem = 'aktif'
      LEFT JOIN users u ON pk.id_user = u.id
      LEFT JOIN transaksi_sewa ts ON kf.id = ts.id_kamar AND ts.status_kontrak = 'aktif' AND ts.id_user = pk.id_user
      WHERE kt.id_kos = ?
      ORDER BY kt.nama_tipe ASC, CAST(kf.nomor_kamar AS UNSIGNED) ASC, kf.nomor_kamar ASC
    `;

    const [kamarRows] = await db.query(queryKamar, [selectedKosId]);

    // Grouping kamar
    const tipeMap = {};
    for (const row of kamarRows) {
      if (row.tipe_id) {
        if (!tipeMap[row.tipe_id]) {
          tipeMap[row.tipe_id] = {
            id: row.tipe_id,
            nama_tipe: row.nama_tipe,
            harga_kamar: row.harga_kamar,
            kamar: []
          };
        }

        if (row.kamar_id) {
          let tanggalSelesai = null;
          if (row.tanggal_mulai_sewa && row.durasi_bulan) {
            try {
              const start = new Date(row.tanggal_mulai_sewa);
              start.setMonth(start.getMonth() + parseInt(row.durasi_bulan));
              const months = [
                "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                "Juli", "Agustus", "September", "Oktober", "November", "Desember"
              ];
              tanggalSelesai = `${start.getDate()} ${months[start.getMonth()]} ${start.getFullYear()}`;
            } catch (e) {
              console.error('[OwnerDashboard] Error calculating tanggalSelesai:', e);
            }
          }

          tipeMap[row.tipe_id].kamar.push({
            id: row.kamar_id,
            nomor_kamar: row.nomor_kamar,
            status_ketersediaan: row.status_ketersediaan,
            penghuni: row.nama_penghuni ? {
              id_kipem: row.id_kipem,
              id_user: row.id_user,
              nama: row.nama_penghuni,
              nik: row.nik_penghuni || '-',
              no_hp: row.no_hp_penghuni,
              email: row.email_penghuni,
              tanggal_masuk: row.tanggal_masuk,
              tanggal_berakhir: row.tanggal_keluar,
              tanggal_selesai: tanggalSelesai
            } : null
          });
        }
      }
    }

    const formattedTipeKamar = Object.values(tipeMap);

    res.json({
      success: true,
      hasKos: true,
      stats: {
        totalPendapatan,
        totalPengeluaran,
        keuntunganBersih,
        totalKamarTerisi,
        totalKamarKosong
      },
      tenants: tenantRows,
      kos: mainKos,
      properties: kosRows,
      selectedKosId: selectedKosId,
      tipe_kamar: formattedTipeKamar
    });

  } catch (error) {
    console.error('Error getOwnerDashboardData:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal mengambil data dashboard pemilik kos',
      error: error.message
    });
  }
};

/**
 * POST /api/kos/owner/checkout-penghuni
 * Mengeluarkan penghuni kos sebelum masa sewa berakhir.
 * Mengubah status_kipem di penghuni_kipem menjadi 'non_aktif' dan id_kamar_fisik menjadi null.
 * Mengubah status kamar di kamar_fisik menjadi 'tersedia'.
 * Mengubah status kontrak di transaksi_sewa menjadi 'selesai'.
 * Menggunakan database transaction.
 */
exports.ownerCheckoutPenghuni = async (req, res) => {
  const { id_kipem } = req.body;
  const userId = req.user.id;

  if (!id_kipem) {
    return res.status(400).json({
      success: false,
      message: 'Parameter id_kipem wajib diisi.'
    });
  }

  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    // 1. Ambil data penghuni dan pastikan kos tersebut milik owner yang sedang login
    const [residentRows] = await connection.query(
      `SELECT pk.id_kipem, pk.id_user, pk.id_kos, pk.id_kamar_fisik 
       FROM penghuni_kipem pk
       JOIN kos k ON pk.id_kos = k.id
       WHERE pk.id_kipem = ? AND k.created_by = ? AND pk.status_kipem = 'aktif' FOR UPDATE`,
      [id_kipem, userId]
    );

    if (residentRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Penghuni aktif tidak ditemukan atau kos bukan milik Anda.'
      });
    }

    const resident = residentRows[0];
    const { id_user, id_kos, id_kamar_fisik } = resident;

    // 2. Set status_kipem menjadi 'non_aktif' dan id_kamar_fisik menjadi null
    await connection.query(
      "UPDATE penghuni_kipem SET status_kipem = 'non_aktif', id_kamar_fisik = NULL WHERE id_kipem = ?",
      [id_kipem]
    );

    // 3. Set status kamar menjadi 'tersedia' di kamar_fisik
    if (id_kamar_fisik) {
      await connection.query(
        "UPDATE kamar_fisik SET status_ketersediaan = 'tersedia' WHERE id = ?",
        [id_kamar_fisik]
      );
    }

    // 4. Set status_kontrak dan status_sewa menjadi 'selesai' di transaksi_sewa
    await connection.query(
      `UPDATE transaksi_sewa 
       SET status_kontrak = 'selesai', 
           status_sewa = 'selesai',
           updated_at = NOW() 
       WHERE id_user = ? AND id_kos = ? AND status_kontrak = 'aktif'`,
      [id_user, id_kos]
    );

    await connection.commit();
    connection.release();

    return res.status(200).json({
      success: true,
      message: 'Penghuni berhasil dikeluarkan (checkout) dari kamar.'
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('[OwnerCheckout] Error ownerCheckoutPenghuni:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses checkout penghuni.',
      error: error.message
    });
  }
};


// ==================== GET ADMIN DASHBOARD STATS ====================
exports.getAdminDashboardStats = async (req, res) => {
  try {
    const filter = req.wilayahFilter || {};
    let whereConditions = ['k.deleted_at IS NULL'];
    let queryParams = [];

    if (filter.desa_adat_id) {
      whereConditions.push('k.desa_adat_id = ?');
      queryParams.push(filter.desa_adat_id);
    }
    if (filter.banjar_adat_id) {
      whereConditions.push('k.banjar_adat_id = ?');
      queryParams.push(filter.banjar_adat_id);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    // 1. Penghuni Aktif Count
    const penghuniQuery = `
      SELECT COUNT(DISTINCT pk.id_kipem) AS count
      FROM penghuni_kipem pk
      JOIN kos k ON pk.id_kos = k.id
      ${whereClause} AND pk.status_kipem = 'aktif'
    `;
    const [penghuniRows] = await db.query(penghuniQuery, queryParams);
    const penghuniAktif = penghuniRows[0]?.count || 0;

    // 2. Perlu Verifikasi Count (Status pending)
    const pendingQuery = `
      SELECT COUNT(*) AS count
      FROM kos k
      ${whereClause} AND k.status_verifikasi = 'pending'
    `;
    const [pendingRows] = await db.query(pendingQuery, queryParams);
    const perluVerifikasi = pendingRows[0]?.count || 0;

    // 3. Total Pendapatan Adat (Iuran Desa yang sudah lunas)
    let revenueQuery = '';
    let revenueParams = [];

    if (filter.banjar_adat_id) {
      // Admin banjar: sum of dues from properties under this banjar (only if tagihan is paid/lunas)
      revenueQuery = `
        SELECT SUM(
          id.nominal * COALESCE((
            SELECT COUNT(*) FROM kos k 
            WHERE k.created_by = tp.pemilik_id 
              AND k.banjar_adat_id = ? 
              AND k.status_verifikasi = 'terverifikasi' 
              AND k.status_aktif = 'aktif' 
              AND k.deleted_at IS NULL
          ), 0)
        ) AS total
        FROM tagihan_pemilik tp
        JOIN iuran_desa id ON tp.iuran_id = id.id
        WHERE tp.status_pembayaran = 'lunas' AND id.desa_adat_id = ?
      `;
      revenueParams = [filter.banjar_adat_id, filter.desa_adat_id];
    } else if (filter.desa_adat_id) {
      // Admin desa: sum of dues in this desa (only if tagihan is paid/lunas)
      revenueQuery = `
        SELECT SUM(
          id.nominal * GREATEST(COALESCE((
            SELECT COUNT(*) FROM kos k 
            WHERE k.created_by = tp.pemilik_id 
              AND k.desa_adat_id = ? 
              AND k.status_verifikasi = 'terverifikasi' 
              AND k.status_aktif = 'aktif' 
              AND k.deleted_at IS NULL
          ), 0), 1)
        ) AS total
        FROM tagihan_pemilik tp
        JOIN iuran_desa id ON tp.iuran_id = id.id
        WHERE tp.status_pembayaran = 'lunas' AND id.desa_adat_id = ?
      `;
      revenueParams = [filter.desa_adat_id, filter.desa_adat_id];
    } else {
      // Super admin: sum of all paid dues in the system
      revenueQuery = `
        SELECT SUM(
          id.nominal * GREATEST(COALESCE((
            SELECT COUNT(*) FROM kos k 
            WHERE k.created_by = tp.pemilik_id 
              AND k.desa_adat_id = id.desa_adat_id 
              AND k.status_verifikasi = 'terverifikasi' 
              AND k.status_aktif = 'aktif' 
              AND k.deleted_at IS NULL
          ), 0), 1)
        ) AS total
        FROM tagihan_pemilik tp
        JOIN iuran_desa id ON tp.iuran_id = id.id
        WHERE tp.status_pembayaran = 'lunas'
      `;
      revenueParams = [];
    }

    const [revenueRows] = await db.query(revenueQuery, revenueParams);
    const totalPendapatan = parseFloat(revenueRows[0]?.total || 0);

    res.json({
      success: true,
      stats: {
        penghuniAktif,
        perluVerifikasi,
        totalPendapatan
      }
    });
  } catch (error) {
    console.error('Error getAdminDashboardStats:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat statistik admin', error: error.message });
  }
};


// ==================== GET ADMIN ACTIVE KOS LIST ====================
exports.getAdminKosAktifList = async (req, res) => {
  try {
    const filter = req.wilayahFilter || {};
    let whereConditions = [
      'k.deleted_at IS NULL',
      "k.status_aktif = 'aktif'",
      "k.status_verifikasi = 'terverifikasi'"
    ];
    let queryParams = [];

    if (filter.desa_adat_id) {
      whereConditions.push('k.desa_adat_id = ?');
      queryParams.push(filter.desa_adat_id);
    }
    if (filter.banjar_adat_id) {
      whereConditions.push('k.banjar_adat_id = ?');
      queryParams.push(filter.banjar_adat_id);
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const query = `
      SELECT 
        k.id AS kos_id,
        k.nama_kos,
        k.alamat_lengkap AS alamat,
        k.nama_pemilik,
        COUNT(CASE WHEN kf.status_ketersediaan = 'terisi' THEN 1 END) AS kamar_terisi
      FROM kos k
      LEFT JOIN kamar_tipe kt ON k.id = kt.id_kos
      LEFT JOIN kamar_fisik kf ON kt.id = kf.id_tipe
      ${whereClause}
      GROUP BY k.id
      ORDER BY k.nama_kos ASC
    `;

    const [rows] = await db.query(query, queryParams);

    res.json({
      success: true,
      kos: rows
    });
  } catch (error) {
    console.error('Error getAdminKosAktifList:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat daftar kos aktif', error: error.message });
  }
};


// ==================== GET ADMIN TRANSACTION HISTORY ====================
exports.getAdminTransactionHistory = async (req, res) => {
  try {
    const filter = req.wilayahFilter || {};
    let whereConditions = ['k.deleted_at IS NULL'];
    let queryParams = [];

    if (filter.desa_adat_id) {
      whereConditions.push('k.desa_adat_id = ?');
      queryParams.push(filter.desa_adat_id);
    }
    if (filter.banjar_adat_id) {
      whereConditions.push('k.banjar_adat_id = ?');
      queryParams.push(filter.banjar_adat_id);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const query = `
      SELECT 
        ts.id_sewa,
        ts.order_id,
        ts.total_harga,
        ts.status_pembayaran,
        ts.status_sewa,
        ts.created_at,
        ts.tanggal_mulai_sewa,
        ts.durasi_bulan,
        u.name AS nama_penghuni,
        u.no_ktp AS nik_penghuni,
        k.nama_kos,
        ba.nama AS nama_banjar,
        da.nama AS nama_desa
      FROM transaksi_sewa ts
      JOIN users u ON ts.id_user = u.id
      JOIN kos k ON ts.id_kos = k.id
      LEFT JOIN banjar_adat ba ON k.banjar_adat_id = ba.id
      LEFT JOIN desa_adat da ON k.desa_adat_id = da.id
      ${whereClause}
      ORDER BY ts.created_at DESC
      LIMIT 100
    `;

    const [rows] = await db.query(query, queryParams);

    res.json({
      success: true,
      transactions: rows
    });
  } catch (error) {
    console.error('Error getAdminTransactionHistory:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat riwayat transaksi', error: error.message });
  }
};


// =========================================================================
// GET OWNER ARUS KAS (CASH FLOW REPORT)
// =========================================================================
exports.getOwnerArusKas = async (req, res) => {
  try {
    const userId = req.user.id;
    const { kosId, bulan, tahun } = req.query;

    if (!kosId || !tahun) {
      return res.status(400).json({ success: false, message: 'Parameter kosId dan tahun wajib diisi.' });
    }

    const [kosRows] = await db.query(
      'SELECT id, nama_kos, desa_adat_id, nama_pemilik, alamat_lengkap FROM kos WHERE id = ? AND created_by = ?',
      [kosId, userId]
    );
    if (kosRows.length === 0) {
      return res.status(403).json({ success: false, message: 'Akses ditolak atau kos tidak ditemukan.' });
    }

    const kos = kosRows[0];
    const isMonthly = bulan && bulan !== 'all';
    const monthFilterIncome = isMonthly ? 'AND MONTH(ts.created_at) = ?' : '';
    const monthFilterExpense = isMonthly ? 'AND MONTH(COALESCE(tp.confirmed_at, tp.updated_at)) = ?' : '';

    // Semua kos milik pemilik
    const [allOwnerKos] = await db.query(
      'SELECT id, nama_kos, desa_adat_id FROM kos WHERE created_by = ? AND deleted_at IS NULL', [userId]
    );
    const kosCountInDesa = allOwnerKos.filter(k => k.desa_adat_id === kos.desa_adat_id).length;

    // ===== PER-KOS: Pendapatan =====
    const [incomeRows] = await db.query(`
      SELECT ts.created_at AS tanggal,
        CONCAT('Sewa Kamar No. ', COALESCE(kf.nomor_kamar, '(-)'), ' - ', u.name) AS deskripsi,
        'masuk' AS tipe, ts.total_harga AS nominal
      FROM transaksi_sewa ts
      LEFT JOIN kamar_fisik kf ON ts.id_kamar = kf.id
      LEFT JOIN users u ON ts.id_user = u.id
      WHERE ts.id_kos = ? AND ts.status_pembayaran = 'settlement'
        ${monthFilterIncome} AND YEAR(ts.created_at) = ?
    `, isMonthly ? [kosId, parseInt(bulan), parseInt(tahun)] : [kosId, parseInt(tahun)]);

    // ===== PER-KOS: Pengeluaran (pro-rate iuran) =====
    const [expRaw] = await db.query(`
      SELECT COALESCE(tp.confirmed_at, tp.updated_at) AS tanggal,
        CONCAT('Iuran Desa: ', id.nama_iuran) AS deskripsi,
        tp.nominal AS nominal_full
      FROM tagihan_pemilik tp
      JOIN iuran_desa id ON tp.iuran_id = id.id
      JOIN kos k ON k.desa_adat_id = id.desa_adat_id
      WHERE tp.pemilik_id = ? AND k.id = ? AND tp.status_pembayaran = 'lunas'
        ${monthFilterExpense} AND YEAR(COALESCE(tp.confirmed_at, tp.updated_at)) = ?
    `, isMonthly ? [userId, kosId, parseInt(bulan), parseInt(tahun)] : [userId, kosId, parseInt(tahun)]);

    const expenseRows = expRaw.map(r => ({
      tanggal: r.tanggal,
      deskripsi: kosCountInDesa > 1 ? `${r.deskripsi} (1/${kosCountInDesa} bagian)` : r.deskripsi,
      tipe: 'keluar',
      nominal: Math.round(parseFloat(r.nominal_full) / kosCountInDesa)
    }));

    const items = [
      ...incomeRows.map(r => ({ tanggal: r.tanggal, deskripsi: r.deskripsi, tipe: r.tipe, nominal: r.nominal })),
      ...expenseRows
    ].sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

    let totalMasuk = 0, totalKeluar = 0;
    items.forEach(i => {
      const n = parseFloat(i.nominal || 0);
      if (i.tipe === 'masuk') totalMasuk += n; else totalKeluar += n;
    });

    // ===== OVERALL: Semua Properti =====
    const allKosIds = allOwnerKos.map(k => k.id);
    let ovMasuk = 0, ovKeluar = 0;
    const ovItems = [];

    if (allKosIds.length > 0) {
      const ph = allKosIds.map(() => '?').join(',');
      const [ovInc] = await db.query(`
        SELECT ts.created_at AS tanggal,
          CONCAT(k2.nama_kos, ' - Sewa ', u.name) AS deskripsi,
          'masuk' AS tipe, ts.total_harga AS nominal
        FROM transaksi_sewa ts
        LEFT JOIN users u ON ts.id_user = u.id
        LEFT JOIN kos k2 ON ts.id_kos = k2.id
        WHERE ts.id_kos IN (${ph}) AND ts.status_pembayaran = 'settlement'
          ${monthFilterIncome} AND YEAR(ts.created_at) = ?
      `, isMonthly ? [...allKosIds, parseInt(bulan), parseInt(tahun)] : [...allKosIds, parseInt(tahun)]);
      ovInc.forEach(r => {
        ovMasuk += parseFloat(r.nominal || 0);
        ovItems.push({ tanggal: r.tanggal, deskripsi: r.deskripsi, tipe: 'masuk', nominal: r.nominal });
      });
    }

    const [ovExp] = await db.query(`
      SELECT COALESCE(tp.confirmed_at, tp.updated_at) AS tanggal,
        CONCAT('Iuran Desa: ', id.nama_iuran) AS deskripsi,
        'keluar' AS tipe, tp.nominal AS nominal
      FROM tagihan_pemilik tp
      JOIN iuran_desa id ON tp.iuran_id = id.id
      WHERE tp.pemilik_id = ? AND tp.status_pembayaran = 'lunas'
        ${monthFilterExpense} AND YEAR(COALESCE(tp.confirmed_at, tp.updated_at)) = ?
    `, isMonthly ? [userId, parseInt(bulan), parseInt(tahun)] : [userId, parseInt(tahun)]);
    ovExp.forEach(r => {
      ovKeluar += parseFloat(r.nominal || 0);
      ovItems.push({ tanggal: r.tanggal, deskripsi: r.deskripsi, tipe: 'keluar', nominal: r.nominal });
    });
    ovItems.sort((a, b) => new Date(b.tanggal) - new Date(a.tanggal));

    res.status(200).json({
      success: true,
      data: {
        kos,
        items,
        summary: { totalMasuk, totalKeluar, labaBersih: totalMasuk - totalKeluar },
        overall: {
          items: ovItems,
          summary: { totalMasuk: ovMasuk, totalKeluar: ovKeluar, labaBersih: ovMasuk - ovKeluar },
          totalProperti: allOwnerKos.length,
          daftarProperti: allOwnerKos.map(k => k.nama_kos)
        }
      }
    });
  } catch (error) {
    console.error('Error in getOwnerArusKas:', error);
    res.status(500).json({ success: false, message: 'Gagal memuat laporan arus kas.', error: error.message });
  }
};
module.exports = exports;