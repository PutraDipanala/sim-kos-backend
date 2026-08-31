const db = require('../src/config/db');

async function run() {
  try {
    // 1. Get all kos properties for owner user 6
    const [kos] = await db.query('SELECT id, name_pemilik, nama_kos FROM kos WHERE created_by = 6 OR created_by IS NULL');
    console.log('--- Kos Properties for Owner (user 6) ---');
    console.log(kos);

    // 2. Get all transaksi_sewa for these kos properties
    for (const k of kos) {
      const [txs] = await db.query(`
        SELECT ts.id_sewa, ts.order_id, ts.id_kos, ts.id_user, ts.total_harga, ts.status_pembayaran, ts.created_at
        FROM transaksi_sewa ts
        WHERE ts.id_kos = ?
      `, [k.id]);
      console.log(`\n--- Transactions for Kos: ${k.nama_kos} (id=${k.id}) ---`);
      console.log(txs);
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
