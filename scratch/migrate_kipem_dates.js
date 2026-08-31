const db = require('../src/config/db');

async function run() {
  try {
    const [columns] = await db.query('DESCRIBE penghuni_kipem');
    const columnNames = columns.map(c => c.Field);

    if (!columnNames.includes('tanggal_masuk')) {
      console.log('Adding column tanggal_masuk to penghuni_kipem...');
      await db.query('ALTER TABLE penghuni_kipem ADD COLUMN tanggal_masuk DATE NULL');
      console.log('Setting default values for tanggal_masuk from tanggal_terdaftar...');
      await db.query('UPDATE penghuni_kipem SET tanggal_masuk = DATE(tanggal_terdaftar)');
    } else {
      console.log('Column tanggal_masuk already exists.');
    }

    if (!columnNames.includes('tanggal_keluar')) {
      console.log('Adding column tanggal_keluar to penghuni_kipem...');
      await db.query('ALTER TABLE penghuni_kipem ADD COLUMN tanggal_keluar DATE NULL');
    } else {
      console.log('Column tanggal_keluar already exists.');
    }

    console.log('Table migration completed successfully!');
    const [newColumns] = await db.query('DESCRIBE penghuni_kipem');
    console.log(newColumns);
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

run();
