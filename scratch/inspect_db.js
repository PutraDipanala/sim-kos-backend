const db = require('../src/config/db');

async function inspect() {
  try {
    const [tables] = await db.query('SHOW TABLES');
    console.log('--- TABLES ---');
    console.log(tables.map(t => Object.values(t)[0]));

    const [usersCols] = await db.query('DESCRIBE users');
    console.log('\n--- users columns ---');
    console.log(usersCols.map(c => ({ Field: c.Field, Type: c.Type, Null: c.Null, Key: c.Key })));

    // Check if table aduan or similar exists
    const tableName = 'aduan';
    const [exists] = await db.query(`SHOW TABLES LIKE '${tableName}'`);
    if (exists.length > 0) {
      const [aduanCols] = await db.query(`DESCRIBE ${tableName}`);
      console.log(`\n--- ${tableName} columns ---`);
      console.log(aduanCols.map(c => ({ Field: c.Field, Type: c.Type })));
    } else {
      console.log(`\nTable '${tableName}' does not exist.`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Inspection error:', error);
    process.exit(1);
  }
}

inspect();
