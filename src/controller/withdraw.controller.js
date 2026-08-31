const db = require('../config/db');

/**
 * getOwnerBalance
 * ─────────────────────────────────────────────────────────────────────────────
 * Mengambil total sewa lunas, total penarikan sebelumnya (pending/proses/selesai),
 * saldo bersih yang tersedia, dan list riwayat penarikan dana milik pemilik kos.
 */
exports.getOwnerBalance = async (req, res) => {
  try {
    const pemilikId = req.user.id;

    // 1. Hitung total sewa lunas
    const [sewaRows] = await db.query(
      `SELECT SUM(ts.total_harga) AS total_sewa_lunas
       FROM transaksi_sewa ts
       JOIN kos k ON ts.id_kos = k.id
       WHERE k.created_by = ? AND ts.status_pembayaran = 'settlement'`,
      [pemilikId]
    );
    const totalSewaLunas = Number(sewaRows[0].total_sewa_lunas || 0);

    // 2. Hitung total penarikan sebelumnya (yang tidak ditolak)
    const [penarikanRows] = await db.query(
      `SELECT SUM(jumlah_penarikan) AS total_penarikan
       FROM penarikan_dana
       WHERE id_pemilik = ? AND status_penarikan != 'ditolak'`,
      [pemilikId]
    );
    const totalPenarikan = Number(penarikanRows[0].total_penarikan || 0);

    // 3. Hitung saldo bersih tersedia
    const saldoTersedia = totalSewaLunas - totalPenarikan;

    // 4. Ambil list riwayat penarikan dana
    const [historyRows] = await db.query(
      `SELECT id, jumlah_penarikan, bank_tujuan, nomor_rekening, nama_pemilik_rekening, status_penarikan, created_at
       FROM penarikan_dana
       WHERE id_pemilik = ?
       ORDER BY created_at DESC`,
      [pemilikId]
    );

    return res.status(200).json({
      success: true,
      message: 'Data saldo pemilik berhasil diambil.',
      data: {
        total_sewa_lunas: totalSewaLunas,
        total_penarikan_sebelumnya: totalPenarikan,
        saldo_tersedia: saldoTersedia,
        history: historyRows
      }
    });

  } catch (error) {
    console.error('[Withdraw] ❌ Error getOwnerBalance:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengambil data saldo.',
      error: error.message
    });
  }
};

/**
 * requestWithdraw
 * ─────────────────────────────────────────────────────────────────────────────
 * Mengajukan permintaan penarikan dana baru. Menggunakan transaksi database
 * dan locking untuk mencegah double withdrawal / race conditions.
 */
exports.requestWithdraw = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const pemilikId = req.user.id;
    const { jumlah_penarikan, bank_tujuan, nomor_rekening, nama_pemilik_rekening } = req.body;

    const nominal = parseInt(jumlah_penarikan, 10);

    // Validasi input dasar
    if (isNaN(nominal) || nominal <= 0) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Nominal penarikan harus berupa angka positif.'
      });
    }

    if (!bank_tujuan || !nomor_rekening || !nama_pemilik_rekening) {
      connection.release();
      return res.status(400).json({
        success: false,
        message: 'Field bank_tujuan, nomor_rekening, dan nama_pemilik_rekening wajib diisi.'
      });
    }

    await connection.beginTransaction();

    // 1. Lock & hitung total pendapatan sewa lunas untuk mencegah race condition
    const [sewaRows] = await connection.query(
      `SELECT SUM(ts.total_harga) AS total_sewa_lunas
       FROM transaksi_sewa ts
       JOIN kos k ON ts.id_kos = k.id
       WHERE k.created_by = ? AND ts.status_pembayaran = 'settlement' FOR UPDATE`,
      [pemilikId]
    );
    const totalSewaLunas = Number(sewaRows[0].total_sewa_lunas || 0);

    // 2. Lock & hitung total penarikan sebelumnya
    const [penarikanRows] = await connection.query(
      `SELECT SUM(jumlah_penarikan) AS total_penarikan
       FROM penarikan_dana
       WHERE id_pemilik = ? AND status_penarikan != 'ditolak' FOR UPDATE`,
      [pemilikId]
    );
    const totalPenarikan = Number(penarikanRows[0].total_penarikan || 0);

    const saldoTersedia = totalSewaLunas - totalPenarikan;

    // 3. Validasi nominal penarikan terhadap saldo tersedia
    if (nominal > saldoTersedia) {
      await connection.rollback();
      connection.release();
      return res.status(400).json({
        success: false,
        message: `Saldo tidak mencukupi. Saldo tersedia Anda saat ini adalah Rp ${saldoTersedia.toLocaleString('id-ID')}.`
      });
    }

    // 4. Insert data penarikan dengan status 'pending'
    const [result] = await connection.query(
      `INSERT INTO penarikan_dana 
        (id_pemilik, jumlah_penarikan, bank_tujuan, nomor_rekening, nama_pemilik_rekening, status_penarikan, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
      [pemilikId, nominal, bank_tujuan, nomor_rekening, nama_pemilik_rekening]
    );

    await connection.commit();
    connection.release();

    return res.status(201).json({
      success: true,
      message: 'Permintaan penarikan dana berhasil diajukan dan sedang diproses.',
      data: {
        id: result.insertId,
        id_pemilik: pemilikId,
        jumlah_penarikan: nominal,
        bank_tujuan,
        nomor_rekening,
        nama_pemilik_rekening,
        status_penarikan: 'pending'
      }
    });

  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error('[Withdraw] ❌ Error requestWithdraw:', error);
    return res.status(500).json({
      success: false,
      message: 'Gagal mengajukan penarikan dana.',
      error: error.message
    });
  }
};
