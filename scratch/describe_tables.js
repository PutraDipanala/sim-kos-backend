const db = require('../src/config/db');

async function run() {
  try {
    const [columnsTS] = await db.query('DESCRIBE transaksi_sewa');
    console.log('--- transaksi_sewa columns ---');
    console.log(columnsTS);

    const [columnsKF] = await db.query('DESCRIBE kamar_fisik');
    console.log('--- kamar_fisik columns ---');
    console.log(columnsKF);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

run();
