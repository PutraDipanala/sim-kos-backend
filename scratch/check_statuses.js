const db = require('../src/config/db');

async function run() {
  try {
    const [rows] = await db.query(`
      SELECT id, nama_kos, status_verifikasi, status_aktif
      FROM kos
      WHERE deleted_at IS NULL
    `);
    console.log('--- All Kos Statuses ---');
    console.log(rows);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
