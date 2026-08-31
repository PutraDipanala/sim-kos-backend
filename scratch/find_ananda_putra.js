const db = require('../src/config/db');

async function run() {
  try {
    // 1. Find user by name "Ananda Putra"
    const [users] = await db.query("SELECT * FROM users WHERE name LIKE '%Ananda%' OR name LIKE '%Putra%'");
    console.log('--- Matching Users ---');
    console.log(users);

    // 2. Find transactions for these users
    for (const u of users) {
      const [txs] = await db.query(`
        SELECT ts.id_sewa, ts.order_id, ts.id_user, ts.id_kos, ts.tanggal_mulai_sewa, ts.durasi_bulan, ts.total_harga, ts.status_pembayaran, ts.created_at
        FROM transaksi_sewa ts
        WHERE ts.id_user = ?
      `, [u.id]);
      console.log(`\n--- Transactions for user: ${u.name} (id=${u.id}) ---`);
      console.log(txs);
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
