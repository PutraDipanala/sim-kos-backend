const db = require('../src/config/db');

async function run() {
  try {
    const [columns] = await db.query('DESCRIBE tagihan_pemilik');
    console.log('tagihan_pemilik columns:', columns);
    const [iuranColumns] = await db.query('DESCRIBE iuran_desa');
    console.log('iuran_desa columns:', iuranColumns);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
