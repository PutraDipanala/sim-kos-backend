const db = require('../src/config/db');

async function run() {
  try {
    const [columns] = await db.query('DESCRIBE transaksi_sewa');
    console.log('transaksi_sewa columns:', columns);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
