const db = require('./src/config/db');

async function check() {
  const tables = ['kamar_fisik', 'kamar_tipe'];
  try {
    for (const table of tables) {
      const [desc] = await db.query(`DESCRIBE \`${table}\``);
      console.log(`\n=== Table: ${table} ===`);
      console.log(desc.map(c => `${c.Field} (${c.Type}) - ${c.Null === 'YES' ? 'NULL' : 'NOT NULL'} - ${c.Key} - ${c.Default}`));
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

check();
