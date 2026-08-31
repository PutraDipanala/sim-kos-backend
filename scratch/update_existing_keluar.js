const db = require('../src/config/db');

async function run() {
  try {
    // 1. Let's see the current records in penghuni_kipem
    const [before] = await db.query('SELECT id_kipem, id_user, id_kos, tanggal_masuk, tanggal_keluar FROM penghuni_kipem');
    console.log('--- Before Update ---');
    console.log(before);

    // 2. Perform the update joining with transaksi_sewa
    console.log('Updating existing records with rental duration from transaksi_sewa...');
    const updateQuery = `
      UPDATE penghuni_kipem pk
      JOIN (
        SELECT id_user, id_kos, tanggal_mulai_sewa, durasi_bulan,
               ROW_NUMBER() OVER(PARTITION BY id_user, id_kos ORDER BY created_at DESC) as rn
        FROM transaksi_sewa
        WHERE status_pembayaran = 'settlement' OR status_pembayaran = 'lunas'
      ) ts ON pk.id_user = ts.id_user AND pk.id_kos = ts.id_kos AND ts.rn = 1
      SET pk.tanggal_masuk = ts.tanggal_mulai_sewa,
          pk.tanggal_keluar = DATE_ADD(ts.tanggal_mulai_sewa, INTERVAL ts.durasi_bulan MONTH)
    `;
    const [result] = await db.query(updateQuery);
    console.log(`Updated ${result.affectedRows} rows.`);

    // 3. See after update
    const [after] = await db.query('SELECT id_kipem, id_user, id_kos, tanggal_masuk, tanggal_keluar, status_kipem FROM penghuni_kipem');
    console.log('--- After Update ---');
    console.log(after);

    process.exit(0);
  } catch (error) {
    console.error('Update failed:', error);
    process.exit(1);
  }
}

run();
