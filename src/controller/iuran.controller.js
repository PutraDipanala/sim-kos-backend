// backend/src/controller/iuran.controller.js
const db             = require('../config/db');
const midtransClient = require('midtrans-client');

// =============================================================================
// CREATE IURAN + AUTO-DISTRIBUTE  (1 langkah)
// POST /api/iuran
// =============================================================================
/**
 * Membuat template iuran baru dan langsung mendistribusikannya sebagai
 * tagihan kepada SEMUA pemilik kos yang memiliki kos terverifikasi di
 * desa_adat_id yang sama dengan Admin yang sedang login.
 *
 * Distribusi bersifat IDEMPOTENT: jika pemilik sudah punya tagihan untuk
 * iuran_id ini (UNIQUE constraint), pemilik tersebut di-skip.
 */
exports.createIuranAndDistribute = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { nama_iuran, nominal, batas_pembayaran, kategori } = req.body;
    const adminDesaId  = req.user.desa_adat_id;
    const adminUserId  = req.user.id;

    // ── Validasi input ─────────────────────────────────────────────────────
    if (!nama_iuran || !nominal || !batas_pembayaran) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Field nama_iuran, nominal, dan batas_pembayaran wajib diisi.',
      });
    }

    if (!adminDesaId) {
      await connection.rollback();
      connection.release();
      return res.status(403).json({
        success: false,
        message: 'Admin tidak memiliki desa_adat_id yang valid. Hubungi Super Admin.',
      });
    }

    const nominalInt = parseInt(nominal, 10);
    if (isNaN(nominalInt) || nominalInt <= 0) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Nominal iuran harus berupa angka positif.',
      });
    }

    const kategoriValid = ['administrasi', 'keamanan', 'kebersihan', 'sosial', 'lainnya'];
    const kategoriValue = kategoriValid.includes(kategori) ? kategori : 'administrasi';

    // ── 1. Insert template iuran ───────────────────────────────────────────
    const [resultIuran] = await connection.query(
      `INSERT INTO iuran_desa
         (desa_adat_id, nama_iuran, nominal, batas_pembayaran, kategori, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [adminDesaId, nama_iuran.trim(), nominalInt, batas_pembayaran, kategoriValue, adminUserId]
    );

    const iuranId = resultIuran.insertId;
    console.log(`[Iuran] ✅ Template iuran ID ${iuranId} berhasil dibuat oleh user ${adminUserId}`);

    // ── 2. Cari semua pemilik kos aktif di desa yang sama ─────────────────
    //       Mengambil DISTINCT pemilik yang punya kos terverifikasi + aktif beserta jumlah kosnya
    const [pemilikRows] = await connection.query(
      `SELECT u.id AS pemilik_id,
              COALESCE((
                SELECT COUNT(*) FROM kos k
                 WHERE k.created_by = u.id
                   AND k.desa_adat_id = ?
                   AND k.status_verifikasi = 'terverifikasi'
                   AND k.status_aktif = 'aktif'
                   AND k.deleted_at IS NULL
              ), 0) AS jumlah_kos
         FROM users u
        WHERE u.role = 'pemilikKos'
          AND EXISTS (
            SELECT 1 FROM kos k
             WHERE k.created_by = u.id
               AND k.desa_adat_id = ?
               AND k.status_verifikasi = 'terverifikasi'
               AND k.status_aktif = 'aktif'
               AND k.deleted_at IS NULL
          )`,
      [adminDesaId, adminDesaId]
    );

    console.log(`[Iuran] 🔍 Ditemukan ${pemilikRows.length} pemilik kos aktif di desa ${adminDesaId}`);

    // ── 3. Batch-insert tagihan ────────────────────────────────────────────
    //       Gunakan INSERT IGNORE untuk skip duplikat (idempotent)
    let distributed = 0;
    let skipped     = 0;

    if (pemilikRows.length > 0) {
      const values = pemilikRows.map(p => {
        const nominalTotal = nominalInt * Math.max(p.jumlah_kos, 1);
        return [
          iuranId,
          p.pemilik_id,
          'iuran',
          nominalTotal,
          batas_pembayaran,
          'pending'
        ];
      });

      const [resultTagihan] = await connection.query(
        `INSERT IGNORE INTO tagihan_pemilik (iuran_id, pemilik_id, jenis_tagihan, nominal, jatuh_tempo, status_pembayaran)
         VALUES ?`,
        [values]
      );

      distributed = resultTagihan.affectedRows;
      skipped     = pemilikRows.length - distributed;

      console.log(
        `[Iuran] 📬 Tagihan terdistribusi: ${distributed} baru, ${skipped} sudah ada (skip).`
      );
    }

    // ── 4. Commit ─────────────────────────────────────────────────────────
    await connection.commit();
    connection.release();

    return res.status(201).json({
      success: true,
      message: `Iuran berhasil dibuat dan didistribusikan ke ${distributed} pemilik kos.`,
      data: {
        iuran_id        : iuranId,
        nama_iuran,
        nominal         : nominalInt,
        batas_pembayaran,
        kategori        : kategoriValue,
        total_pemilik   : pemilikRows.length,
        distributed,
        skipped,
      },
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('[Iuran] ❌ createIuranAndDistribute error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal membuat iuran. Transaksi dibatalkan.',
      error  : error.message,
    });
  }
};


// =============================================================================
// GET DAFTAR IURAN (milik desa Admin yang login)
// GET /api/iuran
// =============================================================================
exports.getIuranList = async (req, res) => {
  try {
    const adminDesaId = req.user.desa_adat_id;
    const banjarAdatId = req.user.banjar_adat_id;
    const userRole    = req.user.role;

    if (!adminDesaId) {
      return res.status(403).json({
        success: false,
        message: 'Admin tidak memiliki desa_adat_id yang valid.',
      });
    }

    let query = '';
    let params = [];

    if (userRole === 'admin_banjar') {
      // Admin banjar: hanya hitung tagihan dari pemilik yang memiliki kos aktif & terverifikasi di banjar ini
      query = `
        SELECT
          id.id,
          id.nama_iuran,
          id.nominal,
          id.batas_pembayaran,
          id.kategori,
          id.is_recurring,
          id.status_template,
          id.created_at,
          da.nama                                       AS nama_desa_adat,
          u.name                                        AS dibuat_oleh,
          COUNT(tp.id)                                  AS total_tagihan,
          SUM(tp.status_pembayaran = 'lunas')           AS total_lunas,
          SUM(tp.status_pembayaran = 'pending')         AS total_pending
        FROM iuran_desa id
        JOIN desa_adat  da ON id.desa_adat_id = da.id
        JOIN users       u ON id.created_by   = u.id
        JOIN tagihan_pemilik tp ON tp.iuran_id = id.id
        WHERE id.desa_adat_id = ?
          AND EXISTS (
            SELECT 1 FROM kos k
             WHERE k.created_by = tp.pemilik_id
               AND k.banjar_adat_id = ?
               AND k.status_verifikasi = 'terverifikasi'
               AND k.status_aktif = 'aktif'
               AND k.deleted_at IS NULL
          )
        GROUP BY id.id
        ORDER BY id.created_at DESC
      `;
      params = [adminDesaId, banjarAdatId];
    } else {
      // Admin Desa / Super Admin: ambil seluruh tagihan di desa tersebut
      query = `
        SELECT
          id.id,
          id.nama_iuran,
          id.nominal,
          id.batas_pembayaran,
          id.kategori,
          id.is_recurring,
          id.status_template,
          id.created_at,
          da.nama                                       AS nama_desa_adat,
          u.name                                        AS dibuat_oleh,
          COUNT(tp.id)                                  AS total_tagihan,
          SUM(tp.status_pembayaran = 'lunas')           AS total_lunas,
          SUM(tp.status_pembayaran = 'pending')         AS total_pending
        FROM iuran_desa id
        JOIN desa_adat  da ON id.desa_adat_id = da.id
        JOIN users       u ON id.created_by   = u.id
        LEFT JOIN tagihan_pemilik tp ON tp.iuran_id = id.id
        WHERE id.desa_adat_id = ?
        GROUP BY id.id
        ORDER BY id.created_at DESC
      `;
      params = [adminDesaId];
    }

    const [rows] = await db.query(query, params);

    return res.json({
      success: true,
      iuran  : rows,
    });

  } catch (error) {
    console.error('[Iuran] ❌ getIuranList error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat daftar iuran.',
      error  : error.message,
    });
  }
};


// =============================================================================
// GET DETAIL TAGIHAN PER IURAN
// GET /api/iuran/:id/tagihan
// =============================================================================
exports.getTagihanByIuran = async (req, res) => {
  try {
    const { id } = req.params;
    const adminDesaId = req.user.desa_adat_id;
    const banjarAdatId = req.user.banjar_adat_id;
    const userRole    = req.user.role;

    // Pastikan iuran milik desa Admin yang login
    const [iuranRows] = await db.query(
      `SELECT * FROM iuran_desa WHERE id = ? AND desa_adat_id = ?`,
      [id, adminDesaId]
    );

    if (iuranRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Iuran tidak ditemukan atau bukan milik desa Anda.',
      });
    }

    const iuran = iuranRows[0];

    // Daftar tagihan dengan info pemilik
    let query = '';
    let params = [];

    if (userRole === 'admin_banjar') {
      // Admin banjar: filter pemilik yang memiliki kos aktif & terverifikasi di banjar ini, dan hitung jumlah kos di banjar ini saja
      query = `
        SELECT
          tp.id,
          tp.status_pembayaran,
          tp.midtrans_order_id,
          tp.confirmed_at,
          tp.created_at,
          u.id        AS pemilik_id,
          u.name      AS nama_pemilik,
          u.email     AS email_pemilik,
          u.no_ktp    AS nik_pemilik,
          conf.name   AS dikonfirmasi_oleh,
          -- Hitung jumlah kos pemilik di BANJAR ini
          COALESCE((
            SELECT COUNT(*) FROM kos k
             WHERE k.created_by = u.id
               AND k.banjar_adat_id = ?
               AND k.status_verifikasi = 'terverifikasi'
               AND k.status_aktif = 'aktif'
               AND k.deleted_at IS NULL
          ), 0) AS jumlah_kos
        FROM tagihan_pemilik tp
        JOIN users u     ON tp.pemilik_id  = u.id
        LEFT JOIN users conf ON tp.confirmed_by = conf.id
        WHERE tp.iuran_id = ?
          AND EXISTS (
            SELECT 1 FROM kos k
             WHERE k.created_by = u.id
               AND k.banjar_adat_id = ?
               AND k.status_verifikasi = 'terverifikasi'
               AND k.status_aktif = 'aktif'
               AND k.deleted_at IS NULL
          )
        ORDER BY tp.status_pembayaran ASC, u.name ASC`;
      params = [banjarAdatId, id, banjarAdatId];
    } else {
      // Admin Desa / Super Admin: tampilkan semua tagihan di desa tersebut
      query = `
        SELECT
          tp.id,
          tp.status_pembayaran,
          tp.midtrans_order_id,
          tp.confirmed_at,
          tp.created_at,
          u.id        AS pemilik_id,
          u.name      AS nama_pemilik,
          u.email     AS email_pemilik,
          u.no_ktp    AS nik_pemilik,
          conf.name   AS dikonfirmasi_oleh,
          -- Hitung jumlah kos pemilik di desa ini yang terverifikasi dan aktif
          COALESCE((
            SELECT COUNT(*) FROM kos k
             WHERE k.created_by = u.id
               AND k.desa_adat_id = ?
               AND k.status_verifikasi = 'terverifikasi'
               AND k.status_aktif = 'aktif'
               AND k.deleted_at IS NULL
          ), 0) AS jumlah_kos
        FROM tagihan_pemilik tp
        JOIN users u     ON tp.pemilik_id  = u.id
        LEFT JOIN users conf ON tp.confirmed_by = conf.id
        WHERE tp.iuran_id = ?
        ORDER BY tp.status_pembayaran ASC, u.name ASC`;
      params = [adminDesaId, id];
    }

    const [tagihan] = await db.query(query, params);

    return res.json({
      success: true,
      iuran,
      tagihan,
      summary: {
        total  : tagihan.length,
        lunas  : tagihan.filter(t => t.status_pembayaran === 'lunas').length,
        pending: tagihan.filter(t => t.status_pembayaran === 'pending').length,
      },
    });

  } catch (error) {
    console.error('[Iuran] ❌ getTagihanByIuran error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat detail tagihan.',
      error  : error.message,
    });
  }
};


// =============================================================================
// KONFIRMASI MANUAL (cadangan untuk pembayaran tunai)
// PATCH /api/iuran/tagihan/:tagihanId/confirm
// =============================================================================
exports.confirmManual = async (req, res) => {
  try {
    const { tagihanId } = req.params;
    const adminUserId   = req.user.id;
    const adminDesaId   = req.user.desa_adat_id;

    // Validasi: tagihan harus milik desa Admin yang login
    const [rows] = await db.query(
      `SELECT tp.id, tp.status_pembayaran, id.desa_adat_id, id.nama_iuran
         FROM tagihan_pemilik tp
         JOIN iuran_desa id ON tp.iuran_id = id.id
        WHERE tp.id = ? AND id.desa_adat_id = ?`,
      [tagihanId, adminDesaId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Tagihan tidak ditemukan atau bukan milik desa Anda.',
      });
    }

    const tagihan = rows[0];

    if (tagihan.status_pembayaran === 'lunas') {
      return res.status(409).json({
        success: false,
        message: 'Tagihan ini sudah berstatus lunas.',
      });
    }

    // Update status ke lunas + catat siapa yang konfirmasi
    const [result] = await db.query(
      `UPDATE tagihan_pemilik
          SET status_pembayaran = 'lunas',
              confirmed_by      = ?,
              confirmed_at      = NOW(),
              updated_at        = NOW()
        WHERE id = ?`,
      [adminUserId, tagihanId]
    );

    if (result.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: 'Gagal mengupdate status tagihan.',
      });
    }

    console.log(
      `[Iuran] ✅ Tagihan ID ${tagihanId} (${tagihan.nama_iuran}) ` +
      `dikonfirmasi manual oleh Admin ID ${adminUserId}`
    );

    return res.json({
      success: true,
      message: `Tagihan untuk iuran "${tagihan.nama_iuran}" berhasil dikonfirmasi sebagai lunas.`,
      tagihan_id: parseInt(tagihanId),
    });

  } catch (error) {
    console.error('[Iuran] ❌ confirmManual error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengkonfirmasi pembayaran.',
      error  : error.message,
    });
  }
};


// =============================================================================
// [PEMILIK KOS] GET TAGIHAN MILIK SAYA
// GET /api/iuran/pemilik/tagihan
// =============================================================================
/**
 * Menampilkan semua tagihan iuran yang diarahkan ke pemilik kos yang sedang login.
 * Disertai informasi nama iuran, nominal, batas pembayaran, dan status.
 */
exports.getTagihanPemilik = async (req, res) => {
  try {
    const pemilikId = req.user.id;

    const [rows] = await db.query(
      `SELECT
         tp.id,
         tp.status_pembayaran,
         tp.midtrans_order_id,
         tp.confirmed_at,
         tp.updated_at,
         id.nama_iuran,
         id.nominal AS nominal_base,
         COALESCE((
           SELECT COUNT(*) FROM kos k
           WHERE k.created_by = tp.pemilik_id
             AND k.desa_adat_id = id.desa_adat_id
             AND k.status_verifikasi = 'terverifikasi'
             AND k.status_aktif = 'aktif'
             AND k.deleted_at IS NULL
         ), 0) AS jumlah_kos,
         COALESCE(NULLIF(tp.nominal, 0.00), id.nominal * GREATEST(COALESCE((
           SELECT COUNT(*) FROM kos k
           WHERE k.created_by = tp.pemilik_id
             AND k.desa_adat_id = id.desa_adat_id
             AND k.status_verifikasi = 'terverifikasi'
             AND k.status_aktif = 'aktif'
             AND k.deleted_at IS NULL
         ), 0), 1)) AS nominal,
         COALESCE(tp.jatuh_tempo, id.batas_pembayaran) AS batas_pembayaran,
         id.kategori,
         da.nama AS nama_desa_adat
       FROM tagihan_pemilik tp
       JOIN iuran_desa id  ON tp.iuran_id     = id.id
       JOIN desa_adat  da  ON id.desa_adat_id = da.id
       WHERE tp.pemilik_id = ?
       ORDER BY tp.status_pembayaran ASC, COALESCE(tp.jatuh_tempo, id.batas_pembayaran) ASC`,
      [pemilikId]
    );

    return res.json({
      success : true,
      tagihan : rows,
    });

  } catch (error) {
    console.error('[Iuran] ❌ getTagihanPemilik error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal memuat tagihan iuran.',
      error  : error.message,
    });
  }
};


// =============================================================================
// [PEMILIK KOS] INITIATE BAYAR IURAN via MIDTRANS SNAP
// POST /api/iuran/pemilik/bayar
// =============================================================================
/**
 * Membuat Midtrans Snap Token untuk tagihan iuran yang dipilih pemilik kos.
 * Menyimpan order_id ke kolom midtrans_order_id di tagihan_pemilik agar webhook
 * handleIuranNotification dapat mencocokkan dan mengkonfirmasi pembayaran.
 */
exports.initiateBayarIuran = async (req, res) => {
  try {
    const { tagihan_id } = req.body;
    const pemilikId      = req.user.id;

    if (!tagihan_id) {
      return res.status(400).json({ success: false, message: 'tagihan_id wajib diisi.' });
    }

    // ── 1. Cari tagihan yang cocok dan milik pemilik ini ─────────────────
    const [rows] = await db.query(
      `SELECT
         tp.id,
         tp.status_pembayaran,
         tp.midtrans_order_id,
         id.nama_iuran,
         id.nominal AS nominal_base,
         COALESCE((
           SELECT COUNT(*) FROM kos k
           WHERE k.created_by = tp.pemilik_id
             AND k.desa_adat_id = id.desa_adat_id
             AND k.status_verifikasi = 'terverifikasi'
             AND k.status_aktif = 'aktif'
             AND k.deleted_at IS NULL
         ), 0) AS jumlah_kos,
         COALESCE(NULLIF(tp.nominal, 0.00), id.nominal * GREATEST(COALESCE((
           SELECT COUNT(*) FROM kos k
           WHERE k.created_by = tp.pemilik_id
             AND k.desa_adat_id = id.desa_adat_id
             AND k.status_verifikasi = 'terverifikasi'
             AND k.status_aktif = 'aktif'
             AND k.deleted_at IS NULL
         ), 0), 1)) AS nominal,
         u.name  AS nama_pemilik,
         u.email AS email_pemilik
       FROM tagihan_pemilik tp
       JOIN iuran_desa id ON tp.iuran_id = id.id
       JOIN users      u  ON tp.pemilik_id = u.id
       WHERE tp.id = ? AND tp.pemilik_id = ?`,
      [tagihan_id, pemilikId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tagihan tidak ditemukan.' });
    }

    const tagihan = rows[0];

    if (tagihan.status_pembayaran === 'lunas') {
      return res.status(409).json({ success: false, message: 'Tagihan ini sudah lunas.' });
    }

    // ── 2. Generate order_id unik ──────────────────────────────────────────
    const orderId = `IURAN-${tagihan.id}-${Date.now()}`;

    // ── 3. Buat Snap Token via Midtrans ────────────────────────────────────
    const snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey   : process.env.MIDTRANS_SERVER_KEY,
    });

    const transaction = await snap.createTransaction({
      transaction_details: {
        order_id    : orderId,
        gross_amount: parseInt(tagihan.nominal),
      },
      customer_details: {
        first_name: tagihan.nama_pemilik,
        email      : tagihan.email_pemilik,
      },
      item_details: [
        {
          id      : `IURAN-${tagihan.id}`,
          price   : parseInt(tagihan.nominal),
          quantity: 1,
          name    : tagihan.nama_iuran.substring(0, 50),
        },
      ],
    });

    // ── 4. Simpan order_id ke tabel tagihan_pemilik ────────────────────────
    await db.query(
      `UPDATE tagihan_pemilik SET midtrans_order_id = ?, updated_at = NOW() WHERE id = ?`,
      [orderId, tagihan.id]
    );

    console.log(`[Iuran] 💳 Snap token dibuat untuk tagihan ID ${tagihan.id}, order_id: ${orderId}`);

    return res.json({
      success    : true,
      snap_token : transaction.token,
      order_id   : orderId,
    });

  } catch (error) {
    console.error('[Iuran] ❌ initiateBayarIuran error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal membuat transaksi pembayaran iuran.',
      error  : error.message,
    });
  }
};

// =============================================================================
// UPDATE TEMPLATE IURAN
// PATCH /api/iuran/:id
// =============================================================================
exports.updateIuran = async (req, res) => {
  try {
    const { id } = req.params;
    const { nama_iuran, nominal, batas_pembayaran, kategori, is_recurring, status_template } = req.body;
    const adminDesaId = req.user.desa_adat_id;

    if (!adminDesaId) {
      return res.status(403).json({
        success: false,
        message: 'Admin tidak memiliki desa_adat_id yang valid.',
      });
    }

    // Pastikan template iuran ada dan milik desa admin yang login
    const [rows] = await db.query(
      'SELECT * FROM iuran_desa WHERE id = ? AND desa_adat_id = ?',
      [id, adminDesaId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Iuran tidak ditemukan atau bukan milik desa Anda.',
      });
    }

    const updates = [];
    const params = [];

    if (nama_iuran !== undefined) {
      updates.push('nama_iuran = ?');
      params.push(nama_iuran.trim());
    }
    if (nominal !== undefined) {
      const nominalInt = parseInt(nominal, 10);
      if (isNaN(nominalInt) || nominalInt <= 0) {
        return res.status(400).json({ success: false, message: 'Nominal harus berupa angka positif.' });
      }
      updates.push('nominal = ?');
      params.push(nominalInt);
    }
    if (batas_pembayaran !== undefined) {
      updates.push('batas_pembayaran = ?');
      params.push(batas_pembayaran);
    }
    if (kategori !== undefined) {
      const kategoriValid = ['administrasi', 'keamanan', 'kebersihan', 'sosial', 'lainnya'];
      if (!kategoriValid.includes(kategori)) {
        return res.status(400).json({ success: false, message: 'Kategori tidak valid.' });
      }
      updates.push('kategori = ?');
      params.push(kategori);
    }
    if (is_recurring !== undefined) {
      updates.push('is_recurring = ?');
      params.push(is_recurring ? 1 : 0);
    }
    if (status_template !== undefined) {
      const statusValid = ['aktif', 'nonaktif'];
      if (!statusValid.includes(status_template)) {
        return res.status(400).json({ success: false, message: 'Status template tidak valid.' });
      }
      updates.push('status_template = ?');
      params.push(status_template);
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: 'Tidak ada field yang dikirim untuk diupdate.' });
    }

    params.push(id);
    await db.query(
      `UPDATE iuran_desa SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    return res.json({
      success: true,
      message: 'Template iuran berhasil diperbarui.',
    });
  } catch (error) {
    console.error('[Iuran] ❌ updateIuran error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal memperbarui template iuran.',
      error: error.message,
    });
  }
};

// =============================================================================
// DELETE TEMPLATE IURAN
// DELETE /api/iuran/:id
// =============================================================================
exports.deleteIuran = async (req, res) => {
  try {
    const { id } = req.params;
    const adminDesaId = req.user.desa_adat_id;

    if (!adminDesaId) {
      return res.status(403).json({
        success: false,
        message: 'Admin tidak memiliki desa_adat_id yang valid.',
      });
    }

    // Pastikan template iuran ada dan milik desa admin yang login
    const [rows] = await db.query(
      'SELECT * FROM iuran_desa WHERE id = ? AND desa_adat_id = ?',
      [id, adminDesaId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Iuran tidak ditemukan atau bukan milik desa Anda.',
      });
    }

    // Melakukan penghapusan (akan cascade menghapus tagihan_pemilik yang terkait)
    await db.query('DELETE FROM iuran_desa WHERE id = ?', [id]);

    return res.json({
      success: true,
      message: 'Template iuran berhasil dihapus.',
    });
  } catch (error) {
    console.error('[Iuran] ❌ deleteIuran error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal menghapus template iuran.',
      error: error.message,
    });
  }
};

