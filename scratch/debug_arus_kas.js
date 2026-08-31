const db = require('../src/config/db');

async function run() {
  try {
    // 1. Get all kos with their owner
    const [kosList] = await db.query('SELECT id, nama_pemilik, nama_kos, created_by, desa_adat_id FROM kos');
    console.log('=== ALL KOS ===');
    kosList.forEach(k => console.log(`  id=${k.id}, nama_kos=${k.nama_kos}, created_by=${k.created_by}, desa_adat_id=${k.desa_adat_id}`));

    // 2. Check ALL transaksi_sewa with settlement status
    const [allSettled] = await db.query(`
      SELECT ts.id_sewa, ts.id_kos, ts.id_user, ts.total_harga, ts.status_pembayaran, 
             ts.created_at, MONTH(ts.created_at) as bulan, YEAR(ts.created_at) as tahun
      FROM transaksi_sewa ts
      WHERE ts.status_pembayaran = 'settlement'
      ORDER BY ts.created_at DESC
    `);
    console.log('\n=== ALL SETTLED TRANSACTIONS ===');
    allSettled.forEach(t => console.log(`  id_sewa=${t.id_sewa}, id_kos=${t.id_kos}, total=${t.total_harga}, bulan=${t.bulan}, tahun=${t.tahun}, created_at=${t.created_at}`));

    // 3. Check all tagihan_pemilik with lunas status
    const [allPaid] = await db.query(`
      SELECT tp.id, tp.pemilik_id, tp.nominal, tp.status_pembayaran,
             tp.confirmed_at, tp.updated_at,
             COALESCE(tp.confirmed_at, tp.updated_at) as tanggal_bayar,
             id.nama_iuran
      FROM tagihan_pemilik tp
      JOIN iuran_desa id ON tp.iuran_id = id.id
      WHERE tp.status_pembayaran = 'lunas'
      ORDER BY COALESCE(tp.confirmed_at, tp.updated_at) DESC
    `);
    console.log('\n=== ALL PAID TAGIHAN (Expenses) ===');
    allPaid.forEach(t => console.log(`  id=${t.id}, pemilik_id=${t.pemilik_id}, nominal=${t.nominal}, iuran=${t.nama_iuran}, tanggal=${t.tanggal_bayar}`));

    // 4. Now test the actual arus kas query for the current month
    const now = new Date();
    const bulan = now.getMonth() + 1; // current month
    const tahun = now.getFullYear();
    console.log(`\n=== Testing for CURRENT month: ${bulan}/${tahun} ===`);
    
    for (const k of kosList) {
      if (!k.created_by) continue;
      const [income] = await db.query(`
        SELECT ts.id_sewa, ts.total_harga, ts.created_at, ts.status_pembayaran
        FROM transaksi_sewa ts
        WHERE ts.id_kos = ? 
          AND ts.status_pembayaran = 'settlement'
          AND MONTH(ts.created_at) = ? 
          AND YEAR(ts.created_at) = ?
      `, [k.id, bulan, tahun]);
      if (income.length > 0) {
        console.log(`  Kos "${k.nama_kos}" (id=${k.id}): ${income.length} income transactions this month`);
        income.forEach(i => console.log(`    id_sewa=${i.id_sewa}, total=${i.total_harga}, date=${i.created_at}`));
      }
    }

    // 5. Check what months actually have data
    const [monthsWithData] = await db.query(`
      SELECT DISTINCT MONTH(created_at) as bulan, YEAR(created_at) as tahun, COUNT(*) as cnt
      FROM transaksi_sewa
      WHERE status_pembayaran = 'settlement'
      GROUP BY YEAR(created_at), MONTH(created_at)
      ORDER BY tahun DESC, bulan DESC
    `);
    console.log('\n=== MONTHS WITH SETTLED TRANSACTIONS ===');
    monthsWithData.forEach(m => console.log(`  ${m.bulan}/${m.tahun}: ${m.cnt} transactions`));

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
