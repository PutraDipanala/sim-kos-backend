const db = require('../src/config/db');

async function run() {
  try {
    const [tables] = await db.query('SHOW TABLES');
    console.log('Database tables:', tables);
    
    // Check if table 'pengeluaran' exists
    const hasPengeluaran = tables.some(row => Object.values(row)[0] === 'pengeluaran');
    console.log('Has table "pengeluaran":', hasPengeluaran);
    
    if (hasPengeluaran) {
      const [columns] = await db.query('DESCRIBE pengeluaran');
      console.log('Columns of "pengeluaran":', columns);
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
