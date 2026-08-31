// backend/src/controller/payment.controller.js
const crypto = require('crypto');
const db     = require('../config/db');


/**
 * verifySignature
 * ─────────────────────────────────────────────────────────────────────────────
 * Memverifikasi signature_key dari notifikasi Midtrans secara lokal
 * tanpa harus memanggil balik ke API Midtrans.
 *
 * Formula: SHA512(order_id + status_code + gross_amount + server_key)
 *
 * @returns {boolean} true jika valid atau jika tidak ada signature (mode test)
 */
const verifySignature = (body) => {
  const { order_id, status_code, gross_amount, signature_key } = body;
  const serverKey = process.env.MIDTRANS_SERVER_KEY;

  // Jika tidak ada signature_key (misalnya saat test manual), lewati verifikasi
  if (!signature_key) {
    console.warn('[Webhook] ⚠️  signature_key tidak ada — request diterima tanpa verifikasi (mode test).');
    return true;
  }

  const expectedSignature = crypto
    .createHash('sha512')
    .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
    .digest('hex');

  return signature_key === expectedSignature;
};

/**
 * handleNotification
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoint ini dipanggil OTOMATIS oleh server Midtrans (HTTP Notification/Webhook)
 * setiap kali status transaksi berubah.
 *
 * Alur Otomatisasi saat Pembayaran Sukses (settlement):
 *  1. Membuka database transaction.
 *  2. Update status_pembayaran menjadi 'settlement' & status_sewa menjadi 'aktif' di transaksi_sewa.
 *  3. SELECT id_kos, id_user, banjar_adat_id, desa_adat_id dari data kos JOIN transaksi_sewa.
 *  4. Mengurangi jumlah_kamar kos (jumlah_kamar = jumlah_kamar - 1).
 *  5. Menambahkan data ke tabel penghuni_kipem (status_kipem = 'aktif', tanggal_terdaftar default CURRENT_TIMESTAMP).
 *  6. Commit transaction jika semua query sukses, jika salah satu gagal maka rollback total.
 */
exports.handleNotification = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const notifikasi = req.body;

    // ── 1. Validasi body minimal ───────────────────────────────────────────────
    if (!notifikasi || !notifikasi.order_id || !notifikasi.transaction_status) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Body notifikasi tidak valid. order_id dan transaction_status wajib ada.',
      });
    }

    // ── 2. Verifikasi signature_key (keamanan dari request palsu) ─────────────
    if (!verifySignature(notifikasi)) {
      console.warn(`[Webhook] ❌ Signature tidak valid untuk order_id: ${notifikasi.order_id}`);
      connection.release();
      return res.status(403).json({
        success: false,
        message: 'Signature tidak valid.',
      });
    }

    const { order_id, transaction_status, fraud_status, payment_type } = notifikasi;

    console.log(
      `[Webhook] 📩 Notifikasi diterima — ` +
      `order_id: ${order_id} | status: ${transaction_status} | fraud: ${fraud_status || '-'} | metode: ${payment_type || '-'}`
    );

    // ── 3. Tentukan nilai status berdasarkan transaction_status & fraud_status ──
    let statusPembayaran = transaction_status;
    let statusSewa       = null; // null = tidak diubah

    if (transaction_status === 'capture') {
      // Khusus kartu kredit
      if (fraud_status === 'accept') {
        statusPembayaran = 'settlement';
        statusSewa       = 'aktif';
      } else if (fraud_status === 'challenge') {
        statusPembayaran = 'challenge';
        // Jangan aktifkan sewa — tunggu review manual
      }

    } else if (transaction_status === 'settlement') {
      // Pembayaran selesai dikonfirmasi (transfer bank, QRIS, dll.)
      statusPembayaran = 'settlement';
      statusSewa       = 'aktif';

    } else if (transaction_status === 'pending') {
      statusPembayaran = 'pending';

    } else if (transaction_status === 'deny') {
      statusPembayaran = 'deny';

    } else if (transaction_status === 'expire') {
      statusPembayaran = 'expire';
      statusSewa       = 'batal';

    } else if (transaction_status === 'cancel') {
      statusPembayaran = 'cancel';
      statusSewa       = 'batal';
    }

    // ── 4. Mulai Database Transaction untuk Keamanan Data ───────────────────
    await connection.beginTransaction();

    let affectedRows = 0;

    if (statusSewa !== null) {
      // Update status_pembayaran DAN status_sewa
      const [result] = await connection.query(
        `UPDATE transaksi_sewa
            SET status_pembayaran = ?,
                status_sewa       = ?,
                updated_at        = NOW()
          WHERE order_id          = ?`,
        [statusPembayaran, statusSewa, order_id]
      );
      affectedRows = result.affectedRows;
    } else {
      // Hanya update status_pembayaran
      const [result] = await connection.query(
        `UPDATE transaksi_sewa
            SET status_pembayaran = ?,
                updated_at        = NOW()
          WHERE order_id          = ?`,
        [statusPembayaran, order_id]
      );
      affectedRows = result.affectedRows;
    }

    if (affectedRows === 0) {
      console.warn(`[Webhook] ⚠️  order_id "${order_id}" tidak ditemukan di tabel transaksi_sewa.`);
      await connection.rollback();
      connection.release();
      return res.status(404).json({
        success: false,
        message: `Order ID ${order_id} tidak ditemukan.`,
      });
    }

    // ── 5. Otomatisasi Khusus saat Pembayaran SUKSES (settlement) ────────────
    if (statusPembayaran === 'settlement') {
      console.log(`[Webhook] ⚙️  Menjalankan otomatisasi pasca-bayar untuk order_id: ${order_id}...`);

      // A. Ambil detail kos, user, id_kamar, banjar, & desa adat beserta informasi sewa
      const [kosRows] = await connection.query(
        `SELECT k.id AS id_kos, ts.id_user, ts.id_kamar, k.banjar_adat_id, k.desa_adat_id,
                ts.tanggal_mulai_sewa, ts.durasi_bulan
           FROM kos k
           JOIN transaksi_sewa ts ON k.id = ts.id_kos 
          WHERE ts.order_id = ?`,
        [order_id]
      );

      if (kosRows.length === 0) {
        throw new Error(`Data kos untuk order_id "${order_id}" tidak dapat ditemukan.`);
      }

      const { id_kos, id_user, id_kamar, banjar_adat_id, desa_adat_id, tanggal_mulai_sewa, durasi_bulan } = kosRows[0];

      // B. Kurangi jumlah kamar kos
      const [updateKamarResult] = await connection.query(
        `UPDATE kos 
            SET jumlah_kamar = jumlah_kamar - 1 
          WHERE id = ? AND jumlah_kamar > 0`,
        [id_kos]
      );

      if (updateKamarResult.affectedRows === 0) {
        console.warn(`[Webhook] ⚠️  Jumlah kamar kos ID ${id_kos} sudah 0 atau kos tidak ditemukan.`);
      } else {
        console.log(`[Webhook] 📉 Jumlah kamar untuk kos ID ${id_kos} berhasil dikurangi 1.`);
      }

      // C. Insert ke tabel penghuni_kipem (tanggal_masuk & tanggal_keluar disesuaikan dengan durasi sewa)
      await connection.query(
        `INSERT INTO penghuni_kipem (id_user, id_kos, banjar_adat_id, desa_adat_id, status_kipem, id_kamar_fisik, tanggal_masuk, tanggal_keluar)
         VALUES (?, ?, ?, ?, 'aktif', ?, ?, DATE_ADD(?, INTERVAL ? MONTH))`,
        [id_user, id_kos, banjar_adat_id, desa_adat_id, id_kamar, tanggal_mulai_sewa, tanggal_mulai_sewa, durasi_bulan]
      );
      console.log(`[Webhook] 📝 Data KIPEM berhasil ditambahkan untuk user ID ${id_user} di kos ID ${id_kos} (kamar: ${id_kamar || 'NULL'}), Masuk: ${tanggal_mulai_sewa}, Keluar: setelah ${durasi_bulan} bulan.`);
    }

    // ── 6. Commit Database Transaction ───────────────────────────────────────
    await connection.commit();
    connection.release();

    console.log(
      `[Webhook] ✅ Seluruh proses DB sukses — ` +
      `order_id: ${order_id} | ` +
      `status_pembayaran: ${statusPembayaran} | ` +
      `status_sewa: ${statusSewa ?? '(tidak berubah)'}`
    );

    // Kembalikan response sukses ke Midtrans
    return res.status(200).json({
      success:            true,
      message:            'Notifikasi berhasil diproses dan disinkronkan ke database.',
      order_id,
      transaction_status: statusPembayaran,
    });

  } catch (error) {
    // Rollback total jika salah satu query gagal
    await connection.rollback();
    connection.release();

    console.error('[Webhook] ❌ Gagal memproses, transaksi di-rollback:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses notifikasi (database rollback dilakukan).',
      error:   error.message,
    });
  }
};


// =============================================================================
// MIDTRANS WEBHOOK — IURAN DESA (Konfirmasi otomatis pembayaran iuran)
// POST /api/payment/iuran-notification
// =============================================================================
/**
 * handleIuranNotification
 * ─────────────────────────────────────────────────────────────────────────────
 * Dipanggil oleh Midtrans ketika pemilik kos menyelesaikan pembayaran iuran.
 * Secara otomatis mengupdate status_pembayaran pada tabel tagihan_pemilik
 * menjadi 'lunas' ketika transaction_status === 'settlement'.
 *
 * ⚠️  Endpoint ini TIDAK butuh autentikasi JWT.
 *     Keamanan dijamin oleh verifikasi signature_key dari Midtrans.
 *
 * Daftarkan URL ini di Midtrans Dashboard → Settings → Configuration:
 *   https://DOMAIN_ANDA/api/payment/iuran-notification
 */
exports.handleIuranNotification = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const notifikasi = req.body;

    // ── 1. Validasi body minimal ───────────────────────────────────────────────
    if (!notifikasi || !notifikasi.order_id || !notifikasi.transaction_status) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Body notifikasi tidak valid. order_id dan transaction_status wajib ada.',
      });
    }

    // ── 2. Verifikasi signature ────────────────────────────────────────────────
    if (!verifySignature(notifikasi)) {
      console.warn(`[IuranWebhook] ❌ Signature tidak valid untuk order_id: ${notifikasi.order_id}`);
      connection.release();
      return res.status(403).json({ success: false, message: 'Signature tidak valid.' });
    }

    const { order_id, transaction_status, fraud_status } = notifikasi;

    console.log(
      `[IuranWebhook] 📩 Notifikasi diterima — ` +
      `order_id: ${order_id} | status: ${transaction_status}`
    );

    // ── 3. Tentukan apakah pembayaran sukses atau gagal ────────────────────────
    const isSettled =
      transaction_status === 'settlement' ||
      (transaction_status === 'capture' && fraud_status === 'accept');

    const isFailed = ['deny', 'cancel', 'expire'].includes(transaction_status);

    if (!isSettled && !isFailed) {
      // Status pending atau tidak relevan — tidak ada yang perlu diupdate
      connection.release();
      return res.status(200).json({
        success: true,
        message: `Status "${transaction_status}" diterima, tidak ada perubahan data.`,
      });
    }

    // ── 4. Cari tagihan yang cocok dengan midtrans_order_id ───────────────────
    const [tagihanRows] = await connection.query(
      `SELECT tp.id, tp.status_pembayaran, id.nama_iuran
         FROM tagihan_pemilik tp
         JOIN iuran_desa id ON tp.iuran_id = id.id
        WHERE tp.midtrans_order_id = ?`,
      [order_id]
    );

    if (tagihanRows.length === 0) {
      console.warn(`[IuranWebhook] ⚠️  midtrans_order_id "${order_id}" tidak ditemukan di tagihan iuran.`);
      connection.release();
      // Kembalikan 200 agar Midtrans tidak retry terus-menerus
      return res.status(200).json({
        success: false,
        message: `Order ID ${order_id} tidak ditemukan di tagihan iuran.`,
      });
    }

    const tagihan = tagihanRows[0];

    if (tagihan.status_pembayaran === 'lunas') {
      console.log(`[IuranWebhook] ℹ️  Tagihan ID ${tagihan.id} sudah lunas, tidak ada perubahan.`);
      connection.release();
      return res.status(200).json({ success: true, message: 'Tagihan sudah berstatus lunas.' });
    }

    await connection.beginTransaction();

    if (isSettled) {
      // ── 5a. Pembayaran sukses → lunas ────────────────────────────────────────
      await connection.query(
        `UPDATE tagihan_pemilik
            SET status_pembayaran = 'lunas',
                updated_at        = NOW()
          WHERE id = ?`,
        [tagihan.id]
      );
      console.log(
        `[IuranWebhook] ✅ Tagihan ID ${tagihan.id} (${tagihan.nama_iuran}) ` +
        `otomatis dikonfirmasi LUNAS via Midtrans.`
      );
    } else if (isFailed) {
      // ── 5b. Pembayaran gagal → reset order_id agar bisa bayar ulang ──────────
      await connection.query(
        `UPDATE tagihan_pemilik
            SET midtrans_order_id = NULL,
                updated_at        = NOW()
          WHERE id = ?`,
        [tagihan.id]
      );
      console.log(
        `[IuranWebhook] ⚠️  Tagihan ID ${tagihan.id} gagal/dibatalkan — order_id direset.`
      );
    }

    await connection.commit();
    connection.release();

    return res.status(200).json({
      success   : true,
      message   : isSettled
        ? 'Tagihan iuran berhasil dikonfirmasi lunas.'
        : 'Pembayaran gagal, tagihan direset untuk percobaan ulang.',
      order_id,
      tagihan_id: tagihan.id,
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('[IuranWebhook] ❌ Gagal memproses, transaksi di-rollback:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Gagal memproses notifikasi iuran (database rollback dilakukan).',
      error  : error.message,
    });
  }
};

// Expose sewa history query from sewa controller or replicate the query here
const sewaController = require('./sewa.controller');
exports.getSewaHistoryByResidentAndRoom = sewaController.getSewaHistoryByResidentAndRoom;
