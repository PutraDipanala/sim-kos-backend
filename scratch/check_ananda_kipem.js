const db = require('../src/config/db');

async function run() {
  try {
    // 1. Find KIPEM record for user 11
    const [kipems] = await db.query('SELECT * FROM penghuni_kipem WHERE id_user = 11');
    console.log('--- KIPEM for Ananda Putra (user 11) ---');
    console.log(kipems);
    
    // 2. Let's see if there are any other users with double transactions
    const [doubleTxs] = await db.query(`
      SELECT id_user, id_kos, tanggal_mulai_sewa, COUNT(*) as count 
      FROM transaksi_sewa 
      WHERE status_pembayaran = 'settlement'
      GROUP BY id_user, id_kos, tanggal_mulai_sewa
      HAVING count > 1
    `);
    console.log('\n--- Users with Double Settlement Transactions ---');
    console.log(doubleTxs);

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
