const db = require('../src/config/db');

async function run() {
  try {
    const [columns] = await db.query('DESCRIBE transaksi_sewa');
    console.log('=== transaksi_sewa Columns ===');
    columns.forEach(c => console.log(`  ${c.Field} (${c.Type}) ${c.Null === 'YES' ? 'NULL' : 'NOT NULL'}`));

    // Check a few settled transactions fully
    const [sample] = await db.query(`
      SELECT * FROM transaksi_sewa WHERE status_pembayaran = 'settlement' LIMIT 3
    `);
    console.log('\n=== Sample SETTLED transactions (all fields) ===');
    sample.forEach(s => {
      console.log(JSON.stringify(s, null, 2));
    });

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
