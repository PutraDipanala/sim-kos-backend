const db = require('../src/config/db');

async function run() {
  try {
    // 1. Delete duplicate transaksi_sewa for Ananda Putra (user 11)
    console.log('Deleting duplicate transaksi_sewa id_sewa=15...');
    const [delTx] = await db.query('DELETE FROM transaksi_sewa WHERE id_sewa = 15');
    console.log('Deleted rows:', delTx.affectedRows);

    // 2. Delete duplicate KIPEM for Ananda Putra (user 11)
    console.log('Deleting duplicate KIPEM records id_kipem IN (9, 19)...');
    const [delKipem] = await db.query('DELETE FROM penghuni_kipem WHERE id_kipem IN (9, 19)');
    console.log('Deleted rows:', delKipem.affectedRows);

    console.log('\n✅ Cleanup of duplicate transactions completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

run();
