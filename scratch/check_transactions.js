const db = require('../src/config/db');

async function run() {
  try {
    // 1. Let's see the active KIPEM rows with their id_user and id_kamar_fisik
    const [kipems] = await db.query(`
      SELECT pk.id_kipem, pk.id_user, pk.id_kamar_fisik, pk.tanggal_masuk, pk.tanggal_keluar
      FROM penghuni_kipem pk
      WHERE pk.status_kipem = 'aktif' AND pk.id_kamar_fisik IS NOT NULL
    `);
    console.log('--- Active KIPEM Rows ---');
    console.log(kipems);

    // 2. Let's see what transaksi_sewa rows we have for these users
    for (const kipem of kipems) {
      const [txs] = await db.query(`
        SELECT id_sewa, order_id, id_user, id_kamar, id_kos, status_pembayaran
        FROM transaksi_sewa
        WHERE id_user = ?
      `, [kipem.id_user]);
      console.log(`\n--- Transactions for id_user=${kipem.id_user} ---`);
      console.log(txs);
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
