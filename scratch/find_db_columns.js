const db = require('../src/config/db');

async function run() {
  try {
    const [tables] = await db.query('SHOW TABLES');
    for (const tableObj of tables) {
      const tableName = Object.values(tableObj)[0];
      const [columns] = await db.query(`DESCRIBE ${tableName}`);
      const matched = columns.filter(c => c.Field.includes('masuk') || c.Field.includes('keluar'));
      if (matched.length > 0) {
        console.log(`Table "${tableName}" has matching columns:`, matched);
      }
    }
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

run();
