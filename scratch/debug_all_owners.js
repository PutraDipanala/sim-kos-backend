const db = require('../src/config/db');

async function run() {
  try {
    // Check which users are pemilikKos
    const [owners] = await db.query(`SELECT id, name, email, role FROM users WHERE role = 'pemilikKos'`);
    console.log('=== All PemilikKos Users ===');
    owners.forEach(o => console.log(`  id=${o.id}, name=${o.name}, email=${o.email}`));

    // For each pemilikKos, check their kos properties and transactions
    for (const owner of owners) {
      const [kosList] = await db.query('SELECT id, nama_kos FROM kos WHERE created_by = ?', [owner.id]);
      console.log(`\n--- ${owner.name} (user ${owner.id}) owns ${kosList.length} kos ---`);
      for (const k of kosList) {
        console.log(`  Kos: "${k.nama_kos}" (id=${k.id})`);
        // Check settled transactions per month
        const [txsByMonth] = await db.query(`
          SELECT MONTH(created_at) as bulan, YEAR(created_at) as tahun, 
                 COUNT(*) as count, SUM(total_harga) as total_pendapatan
          FROM transaksi_sewa 
          WHERE id_kos = ? AND status_pembayaran = 'settlement'
          GROUP BY YEAR(created_at), MONTH(created_at)
          ORDER BY tahun DESC, bulan DESC
        `, [k.id]);
        if (txsByMonth.length > 0) {
          txsByMonth.forEach(t => console.log(`    Bulan ${t.bulan}/${t.tahun}: ${t.count} transaksi, total: Rp ${parseInt(t.total_pendapatan).toLocaleString('id-ID')}`));
        } else {
          console.log(`    (Tidak ada transaksi settlement)`);
        }
      }
    }

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
