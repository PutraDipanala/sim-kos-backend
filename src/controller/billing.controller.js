// backend/src/controller/billing.controller.js
const db = require('../config/db');

/**
 * generateTagihanInternal
 * ─────────────────────────────────────────────────────────────────────────────
 * Core business logic untuk generate tagihan sewa bulanan dan iuran desa.
 * Bisa dipanggil programmatis oleh cron job atau secara manual oleh HTTP endpoint.
 */
const generateTagihanInternal = async () => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    let sewaGenerated  = 0;
    let sewaSkipped    = 0;
    let sewaTahunan    = 0; // kontrak tahunan yang sengaja di-skip
    let iuranGenerated = 0;
    let iuranSkipped   = 0;

    // =========================================================================
    // 1. GENERATE SEWA (Hanya tipe_pembayaran = 'bulanan')
    // =========================================================================
    const [activeSewaRows] = await connection.query(`
      SELECT
        ts.id_sewa,
        ts.tipe_pembayaran,
        ts.harga_saat_transaksi,
        COALESCE(k.created_by, (SELECT u.id FROM users u WHERE u.email = k.email LIMIT 1)) AS pemilik_id
      FROM transaksi_sewa ts
      JOIN kos k ON ts.id_kos = k.id
      WHERE ts.status_kontrak = 'aktif'
    `);

    for (const contract of activeSewaRows) {
      const { id_sewa, tipe_pembayaran, harga_saat_transaksi, pemilik_id } = contract;

      // Skip kontrak TAHUNAN (sudah lunas di awal)
      if (tipe_pembayaran === 'tahunan') {
        sewaTahunan++;
        continue;
      }

      // Defensif: pemilik tidak terdaftar di users
      if (!pemilik_id) {
        sewaSkipped++;
        continue;
      }

      // Hitung jatuh tempo sewa (hari ini + 30 hari)
      const [dateRow] = await connection.query('SELECT DATE_ADD(CURDATE(), INTERVAL 30 DAY) AS jatuh_tempo_sewa');
      const jatuhTempoSewa = dateRow[0].jatuh_tempo_sewa;

      const targetDate  = new Date(jatuhTempoSewa);
      const targetMonth = targetDate.getMonth() + 1;
      const targetYear  = targetDate.getFullYear();

      // Validasi: Cek apakah sudah ada tagihan untuk KONTRAK INI (id_sewa) bulan ini atau bulan target
      const [existingSewa] = await connection.query(`
        SELECT id FROM tagihan_pemilik
        WHERE id_sewa      = ?
          AND jenis_tagihan = 'sewa'
          AND (
            (MONTH(jatuh_tempo) = MONTH(CURRENT_DATE()) AND YEAR(jatuh_tempo) = YEAR(CURRENT_DATE()))
            OR
            (MONTH(jatuh_tempo) = ? AND YEAR(jatuh_tempo) = ?)
          )
      `, [id_sewa, targetMonth, targetYear]);

      if (existingSewa.length > 0) {
        sewaSkipped++;
        continue;
      }

      // Insert tagihan sewa baru untuk pemilik
      await connection.query(`
        INSERT INTO tagihan_pemilik
          (iuran_id, pemilik_id, id_sewa, jenis_tagihan, nominal, jatuh_tempo, status_pembayaran, created_at, updated_at)
        VALUES (NULL, ?, ?, 'sewa', ?, ?, 'pending', NOW(), NOW())
      `, [pemilik_id, id_sewa, harga_saat_transaksi, jatuhTempoSewa]);

      sewaGenerated++;
    }

    // =========================================================================
    // 2. GENERATE IURAN (Hanya untuk is_recurring = 1 dan template aktif)
    // =========================================================================
    const [activeIuranRows] = await connection.query(`
      SELECT id, nominal, desa_adat_id
      FROM iuran_desa
      WHERE status_template = 'aktif' AND is_recurring = 1
    `);

    for (const iuran of activeIuranRows) {
      const { id: iuranId, nominal: templateNominal, desa_adat_id: desaAdatId } = iuran;

      // Ambil pemilik kos yang terdaftar di desa adat iuran ini (memiliki kos aktif & terverifikasi)
      const [pemilikRows] = await connection.query(`
        SELECT DISTINCT u.id AS pemilik_id,
          COALESCE((
            SELECT COUNT(*) FROM kos k2
            WHERE k2.created_by = u.id
              AND k2.desa_adat_id = ?
              AND k2.status_verifikasi = 'terverifikasi'
              AND k2.status_aktif = 'aktif'
              AND k2.deleted_at IS NULL
          ), 0) AS jumlah_kos
        FROM users u
        JOIN kos k ON k.created_by = u.id
        WHERE k.desa_adat_id = ?
          AND k.status_verifikasi = 'terverifikasi'
          AND k.status_aktif = 'aktif'
          AND k.deleted_at IS NULL
          AND u.role = 'pemilikKos'
      `, [desaAdatId, desaAdatId]);

      for (const pemilik of pemilikRows) {
        const { pemilik_id, jumlah_kos } = pemilik;

        // Cek duplikat untuk bulan ini berdasarkan jatuh_tempo
        const [existingIuran] = await connection.query(`
          SELECT id FROM tagihan_pemilik
          WHERE pemilik_id = ?
            AND iuran_id   = ?
            AND MONTH(jatuh_tempo) = MONTH(CURRENT_DATE())
            AND YEAR(jatuh_tempo) = YEAR(CURRENT_DATE())
        `, [pemilik_id, iuranId]);

        if (existingIuran.length > 0) {
          iuranSkipped++;
          continue;
        }

        // Nominal iuran = nominal base * jumlah kos (minimal 1)
        const nominalIuran = templateNominal * Math.max(jumlah_kos, 1);

        // Insert tagihan baru dengan jatuh tempo akhir bulan ini
        await connection.query(`
          INSERT INTO tagihan_pemilik
            (iuran_id, pemilik_id, jenis_tagihan, nominal, jatuh_tempo, status_pembayaran, created_at, updated_at)
          VALUES (?, ?, 'iuran', ?, LAST_DAY(CURRENT_DATE()), 'pending', NOW(), NOW())
        `, [iuranId, pemilik_id, nominalIuran]);

        iuranGenerated++;
      }
    }

    await connection.commit();
    connection.release();

    return {
      sewa: {
        generated: sewaGenerated,
        skipped: sewaSkipped,
        tahunan: sewaTahunan,
      },
      iuran: {
        generated: iuranGenerated,
        skipped: iuranSkipped,
      }
    };

  } catch (error) {
    await connection.rollback();
    connection.release();
    throw error;
  }
};

/**
 * generateTagihanBulanIni
 * HTTP API Controller endpoint.
 */
exports.generateTagihanBulanIni = async (req, res) => {
  try {
    console.log('[Billing API] ⚡ Menjalankan generate tagihan secara manual...');
    const data = await generateTagihanInternal();
    
    return res.status(200).json({
      success: true,
      message: 'Tagihan bulan ini berhasil di-generate secara otomatis.',
      data
    });
  } catch (error) {
    console.error('[Billing API] ❌ Gagal melakukan generate tagihan:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server saat melakukan generate tagihan.',
      error: error.message,
    });
  }
};

// Ekspor fungsi internal untuk diimpor oleh scheduler/cron job
exports.generateTagihanInternal = generateTagihanInternal;
