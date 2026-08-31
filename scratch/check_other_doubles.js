const db = require('../src/config/db');

async function run() {
  try {
    // Check user 12
    const [txs12] = await db.query('SELECT * FROM transaksi_sewa WHERE id_user = 12 AND id_kos = 16');
    console.log('--- Transactions for User 12 in Kos 16 ---');
    console.log(txs12);

    const [kipem12] = await db.query('SELECT * FROM penghuni_kipem WHERE id_user = 12 AND id_kos = 16');
    console.log('--- KIPEM for User 12 in Kos 16 ---');
    console.log(kipem12);

    // Check user 1
    const [txs1] = await db.query('SELECT * FROM transaksi_sewa WHERE id_user = 1 AND id_kos = 8');
    console.log('\n--- Transactions for User 1 in Kos 8 ---');
    console.log(txs1);

    const [kipem1] = await db.query('SELECT * FROM penghuni_kipem WHERE id_user = 1 AND id_kos = 8');
    console.log('--- KIPEM for User 1 in Kos 8 ---');
    console.log(kipem1);

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
