const midtransClient = require('midtrans-client');
const db = require('../config/db');
const { updateStatusKamarDirect } = require('./kamar.controller');

/**
 * createSewa
 * ─────────────────────────────────────────────────────────────────────────────
 * Membuat transaksi sewa baru. Kolom baru yang didukung:
 * - tipe_pembayaran: 'bulanan' | 'tahunan' (default: 'bulanan')
 * - harga_saat_transaksi: snapshot harga kos saat kontrak dibuat
 *   → diambil otomatis dari tabel kos jika tidak dikirim dari frontend
 * - total_tagihan: harga_saat_transaksi × durasi_bulan
 *   → dihitung otomatis di backend untuk menghindari manipulasi client
 */
exports.createSewa = async (req, res) => {
  try {
    const {
      id_user,
      id_kos,
      id_kamar,
      tanggal_mulai_sewa,
      durasi_bulan,
      total_harga,
      tipe_pembayaran
    } = req.body;

    // Validasi input dasar
    if (!id_user || !id_kos || (!id_kamar && !req.body.id_tipe) || !tanggal_mulai_sewa || !durasi_bulan || !total_harga) {
      return res.status(400).json({
        success: false,
        message: 'Semua field (id_user, id_kos, id_kamar atau id_tipe, tanggal_mulai_sewa, durasi_bulan, total_harga) harus diisi.'
      });
    }

    // Validasi tipe_pembayaran
    const validTipe = ['bulanan', 'tahunan'];
    const tipePembayaran = validTipe.includes(tipe_pembayaran) ? tipe_pembayaran : 'bulanan';

    // Gunakan koneksi pool transaction untuk menjamin data integrity & locking
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 0. Cek apakah user sudah memiliki sewa aktif atau pending pembayaran
      const [existingSewa] = await connection.query(
        `SELECT id_sewa, order_id, status_pembayaran 
         FROM transaksi_sewa 
         WHERE id_user = ? 
           AND status_kontrak = 'aktif' 
           AND status_pembayaran IN ('settlement', 'pending')
         LIMIT 1`,
        [id_user]
      );

      if (existingSewa && existingSewa.length > 0) {
        await connection.rollback();
        connection.release();
        const isPending = existingSewa[0].status_pembayaran === 'pending';
        return res.status(400).json({
          success: false,
          message: isPending 
            ? 'Anda masih memiliki tagihan pembayaran sewa yang tertunda (pending). Harap selesaikan pembayaran tersebut atau tunggu hingga kedaluwarsa.' 
            : 'Anda sudah memiliki kontrak sewa aktif. Tidak dapat menyewa kamar baru.'
        });
      }

      let finalKamarId = id_kamar;

      if (!finalKamarId && req.body.id_tipe) {
        // Find first available physical room of this type
        const [availableRoom] = await connection.query(
          'SELECT id FROM kamar_fisik WHERE id_tipe = ? AND status_ketersediaan = "tersedia" LIMIT 1 FOR UPDATE',
          [req.body.id_tipe]
        );
        if (availableRoom.length === 0) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({
            success: false,
            message: 'Tidak ada kamar tersedia untuk tipe kamar ini.'
          });
        }
        finalKamarId = availableRoom[0].id;
      }

      // 1. Ambil & lock kamar untuk mencegah double booking / race condition
      const [kamarRows] = await connection.query(
        `SELECT kf.*, kt.harga_kamar, kt.id_kos 
         FROM kamar_fisik kf
         JOIN kamar_tipe kt ON kf.id_tipe = kt.id
         WHERE kf.id = ? AND kt.id_kos = ? FOR UPDATE`,
        [finalKamarId, id_kos]
      );

      if (!kamarRows || kamarRows.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({
          success: false,
          message: 'Kamar kos tidak ditemukan.'
        });
      }

      const kamar = kamarRows[0];

      // Validasi ketersediaan kamar
      if (kamar.status_ketersediaan !== 'tersedia') {
        await connection.rollback();
        connection.release();
        return res.status(400).json({
          success: false,
          message: `Kamar "${kamar.nomor_kamar}" saat ini sedang tidak tersedia (${kamar.status_ketersediaan}).`
        });
      }

      const hargaSaatTransaksi = Number(kamar.harga_kamar);
      const totalTagihan = hargaSaatTransaksi * durasi_bulan;
      
      // Pembayaran awal (upfront payment) yang dikirim ke Midtrans:
      // - Bulanan: Hanya 1 bulan pertama
      // - Tahunan: Bayar lunas di awal (seluruh durasi)
      const grossAmount = tipePembayaran === 'bulanan' ? hargaSaatTransaksi : totalTagihan;

      // 2. Generate order_id yang unik
      const order_id = `KOS-${Date.now()}`;

      // 3. Buat instance Midtrans Snap
      const snap = new midtransClient.Snap({
        isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
        serverKey: process.env.MIDTRANS_SERVER_KEY,
      });

      // 4. Parameter untuk Midtrans
      const parameter = {
        transaction_details: {
          order_id: order_id,
          gross_amount: grossAmount
        }
      };

      // 5. Buat transaksi di Midtrans
      const transaction = await snap.createTransaction(parameter);
      const snap_token = transaction.token;

      // 6. Insert data ke tabel MySQL transaksi_sewa
      const insertQuery = `
        INSERT INTO transaksi_sewa 
          (order_id, id_user, id_kos, id_kamar, harga_saat_transaksi, tipe_pembayaran,
           tanggal_mulai_sewa, durasi_bulan, harga_per_bulan, total_harga, total_tagihan, snap_token) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await connection.query(insertQuery, [
        order_id,
        id_user,
        id_kos,
        finalKamarId,
        hargaSaatTransaksi,       // snapshot harga kamar
        tipePembayaran,           // 'bulanan' | 'tahunan'
        tanggal_mulai_sewa,
        durasi_bulan,
        hargaSaatTransaksi,       // harga_per_bulan = snapshot harga kamar
        grossAmount,              // total_harga = nominal pembayaran pertama
        totalTagihan,             // total_tagihan = nilai total kontrak sewa
        snap_token
      ]);

      // 7. Update status kamar menjadi 'terisi'
      await connection.query(
        "UPDATE kamar_fisik SET status_ketersediaan = 'terisi' WHERE id = ?",
        [finalKamarId]
      );

      // Commit transaction
      await connection.commit();
      connection.release();

      // Return response
      return res.status(201).json({
        success: true,
        message: 'Transaksi sewa berhasil dibuat',
        snap_token: snap_token,
        order_id: order_id,
        data: {
          id_kamar: finalKamarId,
          harga_saat_transaksi: hargaSaatTransaksi,
          tipe_pembayaran: tipePembayaran,
          total_tagihan: totalTagihan,
        }
      });

    } catch (dbError) {
      await connection.rollback();
      connection.release();
      throw dbError;
    }

  } catch (error) {
    console.error('Error createSewa:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server saat memproses transaksi.',
      error: error.message
    });
  }
};

exports.getSewaByUser = async (req, res) => {
  try {
    const { id_user } = req.params;

    if (!id_user) {
      return res.status(400).json({
        success: false,
        message: 'Parameter id_user wajib diisi.'
      });
    }

    const query = `
      SELECT 
        ts.id_sewa,
        ts.order_id,
        ts.id_user,
        ts.id_kos,
        ts.harga_saat_transaksi,
        ts.tipe_pembayaran,
        ts.tanggal_mulai_sewa,
        ts.durasi_bulan,
        ts.harga_per_bulan,
        ts.total_harga,
        ts.total_tagihan,
        ts.snap_token,
        ts.status_pembayaran,
        ts.status_sewa,
        ts.status_kontrak,
        ts.created_at,
        ts.updated_at,
        k.nama_kos,
        k.alamat_lengkap AS alamat_kos,
        u.name AS nama_user,
        u.email AS email_user,
        ba.nama AS nama_banjar,
        da.nama AS nama_desa_adat
      FROM transaksi_sewa ts
      LEFT JOIN kos k ON ts.id_kos = k.id
      LEFT JOIN users u ON ts.id_user = u.id
      LEFT JOIN banjar_adat ba ON k.banjar_adat_id = ba.id
      LEFT JOIN desa_adat da ON k.desa_adat_id = da.id
      WHERE ts.id_user = ?
      ORDER BY ts.created_at DESC
    `;

    const [rows] = await db.query(query, [id_user]);

    res.status(200).json({
      success: true,
      message: 'Daftar riwayat sewa berhasil diambil.',
      data: rows
    });

  } catch (error) {
    console.error('Error getSewaByUser:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server saat mengambil data sewa.',
      error: error.message
    });
  }
};

// =========================================================================
// UPDATE STATUS KONTRAK
// =========================================================================
// PATCH /api/sewa/:id_sewa/status-kontrak
// Body: { status_kontrak: 'aktif' | 'selesai' | 'batal' }
exports.updateStatusKontrak = async (req, res) => {
  try {
    const { id_sewa } = req.params;
    const { status_kontrak } = req.body;

    const validStatus = ['aktif', 'selesai', 'batal'];
    if (!validStatus.includes(status_kontrak)) {
      return res.status(400).json({
        success: false,
        message: `Status kontrak harus salah satu dari: ${validStatus.join(', ')}`
      });
    }

    // Ambil detail sewa
    const [sewaRows] = await db.query(
      'SELECT id_sewa, id_kamar FROM transaksi_sewa WHERE id_sewa = ?',
      [id_sewa]
    );

    if (sewaRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Transaksi sewa tidak ditemukan.'
      });
    }

    const sewa = sewaRows[0];

    // Update status kontrak
    await db.query(
      'UPDATE transaksi_sewa SET status_kontrak = ?, updated_at = NOW() WHERE id_sewa = ?',
      [status_kontrak, id_sewa]
    );

    // Note: Trigger database (trg_sewa_after_update) akan otomatis mengupdate kamar_kos menjadi 'tersedia' jika status_kontrak = 'selesai' / 'batal'.
    // Namun kita juga bisa secara eksplisit mengupdatenya untuk redundansi jika trigger dinonaktifkan.
    if (status_kontrak === 'selesai' || status_kontrak === 'batal') {
      if (sewa.id_kamar) {
        await updateStatusKamarDirect(sewa.id_kamar, 'tersedia');
      }
    } else if (status_kontrak === 'aktif') {
      if (sewa.id_kamar) {
        await updateStatusKamarDirect(sewa.id_kamar, 'terisi');
      }
    }

    console.log(`[Sewa] 🔄 Status kontrak ID ${id_sewa} → "${status_kontrak}".`);

    return res.status(200).json({
      success: true,
      message: `Status kontrak berhasil diubah ke "${status_kontrak}".`
    });

  } catch (error) {
    console.error('[Sewa] ❌ Error updateStatusKontrak:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengubah status kontrak.',
      error: error.message
    });
  }
};


// =========================================================================
// GET SEWA HISTORY BY RESIDENT & ROOM
// =========================================================================
exports.getSewaHistoryByResidentAndRoom = async (req, res) => {
  try {
    const { id_user, id_kos } = req.query;

    if (!id_user || !id_kos) {
      return res.status(400).json({
        success: false,
        message: 'Parameter id_user dan id_kos wajib diisi.'
      });
    }

    const query = `
      SELECT 
        ts.id_sewa,
        ts.order_id,
        ts.id_user,
        ts.id_kamar,
        ts.id_kos,
        ts.tipe_pembayaran,
        ts.tanggal_mulai_sewa,
        ts.durasi_bulan,
        ts.total_harga,
        ts.status_pembayaran,
        ts.status_sewa,
        ts.status_kontrak,
        ts.created_at AS tanggal_transaksi,
        ts.updated_at
      FROM transaksi_sewa ts
      WHERE ts.id_user = ? AND ts.id_kos = ?
      ORDER BY ts.created_at DESC
    `;

    const [rows] = await db.query(query, [id_user, id_kos]);

    res.status(200).json({
      success: true,
      message: 'Riwayat transaksi berhasil diambil.',
      data: rows
    });

  } catch (error) {
    console.error('Error getSewaHistoryByResidentAndRoom:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan pada server saat mengambil riwayat transaksi.',
      error: error.message
    });
  }
};


