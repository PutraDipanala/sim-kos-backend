const db = require('../src/config/db');

async function run() {
  try {
    console.log('Restoring tanggal_masuk to DATE(tanggal_terdaftar) and setting tanggal_keluar = DATE_ADD(DATE(tanggal_terdaftar), INTERVAL durasi_bulan MONTH)...');
    
    // We update tanggal_masuk to DATE(tanggal_terdaftar)
    // and tanggal_keluar to DATE_ADD(DATE(tanggal_terdaftar), INTERVAL ts.durasi_bulan MONTH)
    const updateQuery = `
      UPDATE penghuni_kipem pk
      JOIN (
        SELECT id_user, id_kos, durasi_bulan,
               ROW_NUMBER() OVER(PARTITION BY id_user, id_kos ORDER BY created_at DESC) as rn
        FROM transaksi_sewa
        WHERE status_pembayaran = 'settlement' OR status_pembayaran = 'lunas'
      ) ts ON pk.id_user = ts.id_user AND pk.id_kos = ts.id_kos AND ts.rn = 1
      SET pk.tanggal_masuk = DATE(pk.tanggal_terdaftar),
          pk.tanggal_keluar = DATE_ADD(DATE(pk.tanggal_terdaftar), INTERVAL ts.durasi_bulan MONTH)
    `;
    const [result] = await db.query(updateQuery);
    console.log(`Updated ${result.affectedRows} rows.`);

    // Check the final dates in database
    const [rows] = await db.query('SELECT id_kipem, id_user, id_kos, tanggal_masuk, tanggal_keluar, status_kipem FROM penghuni_kipem');
    console.log('--- Final KIPEM rows ---');
    console.log(rows);

    process.exit(0);
  } catch (error) {
    console.error('Update failed:', error);
    process.exit(1);
  }
}

run();
