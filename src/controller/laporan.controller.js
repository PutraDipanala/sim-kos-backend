// backend/src/controller/laporan.controller.js
const db = require('../config/db');

/**
 * GET /api/laporan/keuangan
 * Mengambil data laporan keuangan (iuran desa) dengan filter wilayah otomatis & filter bulan-tahun.
 */
exports.getLaporanKeuangan = async (req, res) => {
  try {
    const { month, year } = req.query;
    const user = req.user;

    let whereConditions = ["tp.jenis_tagihan = 'iuran'"];
    let queryParams = [];

    // ── 1. Filter Wilayah Otomatis Berdasarkan Admin yang Login ──────────────
    if (user.role === 'admin_banjar') {
      if (!user.desa_adat_id || !user.banjar_adat_id) {
        return res.status(403).json({
          success: false,
          message: 'Admin Banjar tidak memiliki wilayah adat yang valid.',
        });
      }
      whereConditions.push('id.desa_adat_id = ?');
      queryParams.push(user.desa_adat_id);

      // Pemilik kos harus memiliki kos yang aktif & terverifikasi di Banjar admin ini
      whereConditions.push(`
        EXISTS (
          SELECT 1 FROM kos k
          WHERE k.created_by = tp.pemilik_id
            AND k.banjar_adat_id = ?
            AND k.status_verifikasi = 'terverifikasi'
            AND k.status_aktif = 'aktif'
            AND k.deleted_at IS NULL
        )
      `);
      queryParams.push(user.banjar_adat_id);
    } else if (user.role === 'admin_desa' || user.role === 'super_admin') {
      // Jika super_admin tidak memiliki desa_adat_id, lewati filter wilayah
      if (user.desa_adat_id) {
        whereConditions.push('id.desa_adat_id = ?');
        queryParams.push(user.desa_adat_id);
      } else if (user.role === 'admin_desa') {
        return res.status(403).json({
          success: false,
          message: 'Admin Desa tidak memiliki wilayah adat yang valid.',
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Peran Anda tidak diizinkan untuk melihat laporan ini.',
      });
    }

    // ── 2. Filter Bulan & Tahun (Berdasarkan tanggal tagihan tp.created_at) ───
    if (year) {
      if (month && month !== 'all' && month !== '') {
        whereConditions.push('MONTH(tp.created_at) = ? AND YEAR(tp.created_at) = ?');
        queryParams.push(parseInt(month, 10), parseInt(year, 10));
      } else {
        whereConditions.push('YEAR(tp.created_at) = ?');
        queryParams.push(parseInt(year, 10));
      }
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const query = `
      SELECT 
        tp.id AS tagihan_id,
        id.nama_iuran,
        id.kategori,
        tp.nominal AS nominal_tagihan,
        tp.status_pembayaran,
        tp.created_at AS tanggal_tagihan,
        tp.confirmed_at AS tanggal_bayar,
        u.name AS nama_pemilik,
        u.email AS email_pemilik,
        u.no_hp AS no_hp_pemilik
      FROM tagihan_pemilik tp
      JOIN iuran_desa id ON tp.iuran_id = id.id
      JOIN users u ON tp.pemilik_id = u.id
      ${whereClause}
      ORDER BY tp.created_at DESC
    `;

    console.log('[Laporan Keuangan] Running query with params:', queryParams);
    const [rows] = await db.query(query, queryParams);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error('[Laporan Keuangan] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat laporan keuangan.',
      error: error.message,
    });
  }
};

/**
 * GET /api/laporan/kependudukan
 * Mengambil data laporan kependudukan (penyewa kos / KIPEM) dengan filter wilayah otomatis & filter bulan-tahun.
 */
exports.getLaporanKependudukan = async (req, res) => {
  try {
    const { month, year } = req.query;
    const user = req.user;

    let whereConditions = [];
    let queryParams = [];

    // ── 1. Filter Wilayah Otomatis Berdasarkan Admin yang Login ──────────────
    if (user.role === 'admin_banjar') {
      if (!user.desa_adat_id || !user.banjar_adat_id) {
        return res.status(403).json({
          success: false,
          message: 'Admin Banjar tidak memiliki wilayah adat yang valid.',
        });
      }
      whereConditions.push('pk.desa_adat_id = ? AND pk.banjar_adat_id = ?');
      queryParams.push(user.desa_adat_id, user.banjar_adat_id);
    } else if (user.role === 'admin_desa' || user.role === 'super_admin') {
      if (user.desa_adat_id) {
        whereConditions.push('pk.desa_adat_id = ?');
        queryParams.push(user.desa_adat_id);
      } else if (user.role === 'admin_desa') {
        return res.status(403).json({
          success: false,
          message: 'Admin Desa tidak memiliki wilayah adat yang valid.',
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Peran Anda tidak diizinkan untuk melihat laporan ini.',
      });
    }

    // ── 2. Filter Bulan & Tahun (Overlap Logic berdasarkan tanggal_masuk dan tanggal_keluar) ───
    if (year) {
      if (month && month !== 'all' && month !== '') {
        const firstDayStr = `${year}-${String(month).padStart(2, '0')}-01`;
        whereConditions.push('pk.tanggal_masuk <= LAST_DAY(?) AND (pk.tanggal_keluar >= ? OR pk.tanggal_keluar IS NULL)');
        queryParams.push(firstDayStr, firstDayStr);
      } else {
        const startOfYear = `${year}-01-01`;
        const endOfYear = `${year}-12-31`;
        whereConditions.push('pk.tanggal_masuk <= ? AND (pk.tanggal_keluar >= ? OR pk.tanggal_keluar IS NULL)');
        queryParams.push(endOfYear, startOfYear);
      }
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

    const query = `
      SELECT 
        pk.id_kipem,
        CASE 
          WHEN pk.tanggal_keluar IS NULL OR pk.tanggal_keluar > CURDATE() THEN 'aktif'
          ELSE 'non_aktif'
        END AS status_kipem,
        pk.tanggal_terdaftar,
        pk.tanggal_masuk,
        pk.tanggal_keluar,
        u.name AS nama_penghuni,
        u.email AS email_penghuni,
        u.no_hp AS no_hp_penghuni,
        u.no_ktp AS no_ktp_penghuni,
        u.alamat_lengkap AS alamat_asal_penghuni,
        u.pekerjaan AS pekerjaan_penghuni,
        k.nama_kos,
        kf.nomor_kamar,
        kt.nama_tipe AS tipe_kamar,
        da.nama AS nama_desa,
        ba.nama AS nama_banjar
      FROM penghuni_kipem pk
      JOIN users u ON pk.id_user = u.id
      JOIN kos k ON pk.id_kos = k.id
      LEFT JOIN kamar_fisik kf ON pk.id_kamar_fisik = kf.id
      LEFT JOIN kamar_tipe kt ON kf.id_tipe = kt.id
      LEFT JOIN desa_adat da ON pk.desa_adat_id = da.id
      LEFT JOIN banjar_adat ba ON pk.banjar_adat_id = ba.id
      ${whereClause}
      ORDER BY pk.tanggal_masuk DESC
    `;

    console.log('[Laporan Kependudukan] Running query with params:', queryParams);
    const [rows] = await db.query(query, queryParams);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error('[Laporan Kependudukan] Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat laporan kependudukan.',
      error: error.message,
    });
  }
};
