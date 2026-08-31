const db = require('../src/config/db');

async function run() {
  try {
    // Check if there are duplicate active KIPEMs for the same physical room
    const [duplicates] = await db.query(`
      SELECT id_kamar_fisik, COUNT(*) as count 
      FROM penghuni_kipem 
      WHERE status_kipem = 'aktif' AND id_kamar_fisik IS NOT NULL
      GROUP BY id_kamar_fisik
      HAVING count > 1
    `);
    console.log('--- Physical Rooms with Multiple Active Residents ---');
    console.log(duplicates);

    // If there are duplicate active residents, let's list their details
    for (const dup of duplicates) {
      const [residents] = await db.query(`
        SELECT pk.id_kipem, pk.id_user, pk.id_kos, pk.id_kamar_fisik, u.name as resident_name, pk.tanggal_masuk, pk.tanggal_keluar
        FROM penghuni_kipem pk
        JOIN users u ON pk.id_user = u.id
        WHERE pk.id_kamar_fisik = ? AND pk.status_kipem = 'aktif'
      `, [dup.id_kamar_fisik]);
      console.log(`\nDetails for room physical ID ${dup.id_kamar_fisik}:`);
      console.log(residents);
    }
    
    // Also check if there are multiple active sewa transactions for the same room at overlapping times
    const [doubleSewa] = await db.query(`
      SELECT id_kamar, COUNT(*) as count 
      FROM transaksi_sewa 
      WHERE status_kontrak = 'aktif' AND status_pembayaran = 'settlement' AND id_kamar IS NOT NULL
      GROUP BY id_kamar
      HAVING count > 1
    `);
    console.log('\n--- Rooms with Multiple Active Sewa Contracts ---');
    console.log(doubleSewa);

    for (const ds of doubleSewa) {
      const [contracts] = await db.query(`
        SELECT ts.id_sewa, ts.order_id, ts.id_user, u.name as resident_name, ts.tanggal_mulai_sewa, ts.durasi_bulan
        FROM transaksi_sewa ts
        JOIN users u ON ts.id_user = u.id
        WHERE ts.id_kamar = ? AND ts.status_kontrak = 'aktif' AND ts.status_pembayaran = 'settlement'
      `, [ds.id_kamar]);
      console.log(`\nDetails for room ID ${ds.id_kamar}:`);
      console.log(contracts);
    }

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
