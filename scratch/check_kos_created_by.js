const db = require('../src/config/db');

async function run() {
  try {
    const [rows] = await db.query(`
      SELECT k.id, k.nama_kos, k.created_by, u.id AS user_id, u.name AS user_name, k.status_verifikasi
      FROM kos k
      LEFT JOIN users u ON k.created_by = u.id
      WHERE k.deleted_at IS NULL
    `);
    console.log('--- Kos and Owner Check ---');
    console.log(rows);
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
