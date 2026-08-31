const db = require('../src/config/db');

async function run() {
  try {
    // 1. Delete the invalid KIPEM record (id_kipem = 25) which links Kos 11 to room 19 (which actually belongs to Kos 9)
    console.log('Deleting invalid KIPEM id_kipem=25...');
    const [delKipem] = await db.query('DELETE FROM penghuni_kipem WHERE id_kipem = 25');
    console.log('Deleted rows:', delKipem.affectedRows);

    // 2. Set id_kamar to NULL for transaksi_sewa id_sewa=23 (since room 19 is in Kos 9, not Kos 11)
    console.log('Updating transaksi_sewa id_sewa=23 set id_kamar = NULL...');
    const [updTx] = await db.query('UPDATE transaksi_sewa SET id_kamar = NULL WHERE id_sewa = 23');
    console.log('Updated rows:', updTx.affectedRows);

    console.log('\n✅ Cleanup of room 19 double occupancy completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    process.exit(1);
  }
}

run();
