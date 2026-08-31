// backend/src/controller/admin.controller.js
const db = require('../config/db');

/**
 * GET /api/admin/monitoring
 * Mengambil data monitoring kos, tipe kamar, nomor kamar, status ketersediaan,
 * dan nama/kontak penghuni jika kamar tersebut terisi.
 * Data difilter berdasarkan wilayah adat admin yang sedang login.
 */
exports.getMonitoringData = async (req, res) => {
  try {
    const user = req.user;
    const filter = req.wilayahFilter || {};
    
    let whereConditions = ['k.deleted_at IS NULL'];
    let queryParams = [];

    // Filter server-side:
    // admin_banjar -> filter by banjar_adat_id
    // admin_desa -> filter by desa_adat_id
    // super_admin -> show all (no additional filters)
    if (user.role === 'admin_banjar' && filter.banjar_adat_id) {
      whereConditions.push('k.banjar_adat_id = ?');
      queryParams.push(filter.banjar_adat_id);
    } else if (user.role === 'admin_desa' && filter.desa_adat_id) {
      whereConditions.push('k.desa_adat_id = ?');
      queryParams.push(filter.desa_adat_id);
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const query = `
      SELECT 
        k.id AS kos_id,
        k.nama_kos,
        k.tipe_kos,
        k.alamat_lengkap,
        k.desa_adat_id,
        k.banjar_adat_id,
        da.nama AS nama_desa,
        ba.nama AS nama_banjar,
        
        kt.id AS tipe_id,
        kt.nama_tipe,
        kt.harga_kamar,
        
        kf.id AS kamar_id,
        kf.nomor_kamar,
        kf.status_ketersediaan,
        
        pk.id_kipem,
        pk.status_kipem,
        u.name AS nama_penghuni,
        u.no_ktp AS nik_penghuni,
        u.no_hp AS no_hp_penghuni,
        u.email AS email_penghuni,
        
        ts.tanggal_mulai_sewa,
        ts.durasi_bulan
      FROM kos k
      LEFT JOIN desa_adat da ON k.desa_adat_id = da.id
      LEFT JOIN banjar_adat ba ON k.banjar_adat_id = ba.id
      LEFT JOIN kamar_tipe kt ON k.id = kt.id_kos
      LEFT JOIN kamar_fisik kf ON kt.id = kf.id_tipe
      LEFT JOIN penghuni_kipem pk ON kf.id = pk.id_kamar_fisik AND pk.status_kipem = 'aktif'
      LEFT JOIN users u ON pk.id_user = u.id
      LEFT JOIN transaksi_sewa ts ON kf.id = ts.id_kamar AND ts.status_kontrak = 'aktif' AND ts.id_user = pk.id_user
      ${whereClause}
      ORDER BY k.nama_kos ASC, kt.nama_tipe ASC, CAST(kf.nomor_kamar AS UNSIGNED) ASC, kf.nomor_kamar ASC
    `;

    console.log('[Monitoring] Running query with params:', queryParams);
    const [rows] = await db.query(query, queryParams);

    // Grouping data on server side
    const kosMap = {};
    for (const row of rows) {
      if (!kosMap[row.kos_id]) {
        kosMap[row.kos_id] = {
          id: row.kos_id,
          nama_kos: row.nama_kos,
          tipe_kos: row.tipe_kos,
          alamat_lengkap: row.alamat_lengkap,
          nama_desa: row.nama_desa || '-',
          nama_banjar: row.nama_banjar || '-',
          tipe_kamar: {}
        };
      }

      if (row.tipe_id) {
        if (!kosMap[row.kos_id].tipe_kamar[row.tipe_id]) {
          kosMap[row.kos_id].tipe_kamar[row.tipe_id] = {
            id: row.tipe_id,
            nama_tipe: row.nama_tipe,
            harga_kamar: row.harga_kamar,
            kamar: []
          };
        }

        if (row.kamar_id) {
          const roomExists = kosMap[row.kos_id].tipe_kamar[row.tipe_id].kamar.some(kmr => kmr.id === row.kamar_id);
          if (!roomExists) {
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
                console.error('[Monitoring] Error calculating tanggalSelesai:', e);
              }
            }

            kosMap[row.kos_id].tipe_kamar[row.tipe_id].kamar.push({
              id: row.kamar_id,
              nomor_kamar: row.nomor_kamar,
              status_ketersediaan: row.status_ketersediaan,
              penghuni: row.nama_penghuni ? {
                id_kipem: row.id_kipem,
                nama: row.nama_penghuni,
                nik: row.nik_penghuni || '-',
                no_hp: row.no_hp_penghuni,
                email: row.email_penghuni,
                tanggal_selesai: tanggalSelesai
              } : null
            });
          }
        }
      }
    }

    // Transform map to arrays and include statistics
    const formattedData = Object.values(kosMap).map(kos => ({
      ...kos,
      tipe_kamar: Object.values(kos.tipe_kamar).map(tipe => ({
        ...tipe,
        total_kamar: tipe.kamar.length,
        kamar_terisi: tipe.kamar.filter(k => k.status_ketersediaan === 'terisi').length,
        kamar_tersedia: tipe.kamar.filter(k => k.status_ketersediaan === 'tersedia').length
      }))
    }));

    res.json({
      success: true,
      data: formattedData
    });

  } catch (error) {
    console.error('[Monitoring] Error getMonitoringData:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data monitoring.',
      error: error.message
    });
  }
};

/**
 * GET /api/admin/unsynced-penghuni
 * Mengambil data penghuni yang status_kipem = 'aktif' tetapi id_kamar_fisik IS NULL.
 * Disertai dengan daftar kamar kosong yang tersedia (status_ketersediaan = 'tersedia') 
 * pada kos masing-masing penghuni tersebut.
 */
exports.getUnsyncedPenghuni = async (req, res) => {
  try {
    const user = req.user;
    const filter = req.wilayahFilter || {};

    let whereConditions = ['pk.id_kamar_fisik IS NULL', "pk.status_kipem = 'aktif'", 'k.deleted_at IS NULL'];
    let queryParams = [];

    // Filter wilayah server-side
    if (user.role === 'admin_banjar' && filter.banjar_adat_id) {
      whereConditions.push('k.banjar_adat_id = ?');
      queryParams.push(filter.banjar_adat_id);
    } else if (user.role === 'admin_desa' && filter.desa_adat_id) {
      whereConditions.push('k.desa_adat_id = ?');
      queryParams.push(filter.desa_adat_id);
    }

    const whereClause = 'WHERE ' + whereConditions.join(' AND ');

    const queryUnsynced = `
      SELECT 
        pk.id_kipem,
        pk.id_user,
        pk.id_kos,
        pk.tanggal_terdaftar,
        u.name AS nama_penghuni,
        u.no_ktp AS nik_penghuni,
        u.no_hp AS no_hp_penghuni,
        k.nama_kos,
        da.nama AS nama_desa,
        ba.nama AS nama_banjar
      FROM penghuni_kipem pk
      JOIN users u ON pk.id_user = u.id
      JOIN kos k ON pk.id_kos = k.id
      LEFT JOIN desa_adat da ON k.desa_adat_id = da.id
      LEFT JOIN banjar_adat ba ON k.banjar_adat_id = ba.id
      ${whereClause}
      ORDER BY pk.tanggal_terdaftar DESC
    `;

    const [residents] = await db.query(queryUnsynced, queryParams);

    if (residents.length === 0) {
      return res.json({
        success: true,
        data: []
      });
    }

    // Ambil semua id_kos yang unik
    const kosIds = [...new Set(residents.map(r => r.id_kos))];

    // Ambil semua kamar kosong pada kos-kos tersebut
    const queryRooms = `
      SELECT 
        kf.id AS kamar_id,
        kf.nomor_kamar,
        kt.nama_tipe,
        kt.harga_kamar,
        kt.id_kos
      FROM kamar_fisik kf
      JOIN kamar_tipe kt ON kf.id_tipe = kt.id
      WHERE kf.status_ketersediaan = 'tersedia'
        AND kt.id_kos IN (?)
      ORDER BY kt.id_kos ASC, CAST(kf.nomor_kamar AS UNSIGNED) ASC, kf.nomor_kamar ASC
    `;

    const [rooms] = await db.query(queryRooms, [kosIds]);

    // Grouping kamar kosong berdasarkan id_kos
    const roomsByKos = {};
    for (const room of rooms) {
      if (!roomsByKos[room.id_kos]) {
        roomsByKos[room.id_kos] = [];
      }
      roomsByKos[room.id_kos].push({
        id: room.kamar_id,
        nomor_kamar: room.nomor_kamar,
        nama_tipe: room.nama_tipe,
        harga_kamar: room.harga_kamar
      });
    }

    // Tempelkan daftar kamar kosong ke masing-masing objek penghuni
    const result = residents.map(resident => ({
      ...resident,
      kamar_kosong: roomsByKos[resident.id_kos] || []
    }));

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[Sinkronisasi] Error getUnsyncedPenghuni:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data penghuni belum tersinkronisasi.',
      error: error.message
    });
  }
};

/**
 * POST /api/admin/sinkronisasi-penghuni
 * Melakukan pemetaan/sinkronisasi penghuni ke kamar fisik.
 * Mengubah id_kamar_fisik di penghuni_kipem dan mengubah status_ketersediaan kamar di kamar_fisik menjadi 'terisi'.
 * Menggunakan database transaction untuk menjamin data integrity.
 */
exports.sinkronisasiPenghuni = async (req, res) => {
  const { id_kipem, id_kamar_fisik } = req.body;

  if (!id_kipem || !id_kamar_fisik) {
    return res.status(400).json({
      success: false,
      message: 'Parameter id_kipem dan id_kamar_fisik wajib diisi.'
    });
  }

  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    // 1. Ambil & lock data penghuni
    const [residentRows] = await connection.query(
      'SELECT id_kipem, id_kos, id_kamar_fisik FROM penghuni_kipem WHERE id_kipem = ? FOR UPDATE',
      [id_kipem]
    );

    if (residentRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Penghuni KIPEM tidak ditemukan.'
      });
    }

    const resident = residentRows[0];
    if (resident.id_kamar_fisik !== null) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Penghuni KIPEM sudah memiliki kamar (sudah tersinkronisasi).'
      });
    }

    // 2. Ambil & lock data kamar fisik
    const [roomRows] = await connection.query(
      `SELECT kf.id, kf.status_ketersediaan, kt.id_kos 
       FROM kamar_fisik kf
       JOIN kamar_tipe kt ON kf.id_tipe = kt.id
       WHERE kf.id = ? FOR UPDATE`,
      [id_kamar_fisik]
    );

    if (roomRows.length === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: 'Kamar fisik tidak ditemukan.'
      });
    }

    const room = roomRows[0];
    if (room.id_kos !== resident.id_kos) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Kamar yang dipilih tidak berada di properti kos yang sama dengan penghuni.'
      });
    }

    if (room.status_ketersediaan !== 'tersedia') {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Kamar yang dipilih tidak berstatus tersedia (sudah terisi).'
      });
    }

    // 3. Update penghuni_kipem
    await connection.query(
      'UPDATE penghuni_kipem SET id_kamar_fisik = ? WHERE id_kipem = ?',
      [id_kamar_fisik, id_kipem]
    );

    // 4. Update kamar_fisik
    await connection.query(
      "UPDATE kamar_fisik SET status_ketersediaan = 'terisi' WHERE id = ?",
      [id_kamar_fisik]
    );

    // Commit transaksi
    await connection.commit();
    connection.release();

    return res.status(200).json({
      success: true,
      message: 'Sinkronisasi penghuni berhasil dilakukan.'
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('[Sinkronisasi] Error sinkronisasiPenghuni:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server saat melakukan sinkronisasi.',
      error: error.message
    });
  }
};

