const db = require('../src/config/db');

async function run() {
  try {
    const [rows] = await db.query('SELECT * FROM penghuni_kipem LIMIT 5');
    console.log('--- Sample rows of penghuni_kipem ---');
    console.log(rows);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

run();
