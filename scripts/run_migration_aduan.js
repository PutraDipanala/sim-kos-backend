// backend/scripts/run_migration_aduan.js
// Run: node scripts/run_migration_aduan.js
require('dotenv').config();
const db = require('../src/config/db');

async function runMigration() {
  console.log('🚀 Starting aduan escalation migration...\n');

  const steps = [
    {
      name: 'Update status ENUM (tambah diteruskan)',
      sql: `ALTER TABLE aduan MODIFY COLUMN status ENUM('menunggu','diproses','selesai','diteruskan') NOT NULL DEFAULT 'menunggu'`,
    },
    {
      name: 'Tambah kolom recipient_role',
      sql: `ALTER TABLE aduan ADD COLUMN recipient_role ENUM('admin_banjar','admin_desa','super_admin') NULL AFTER id_banjar`,
    },
    {
      name: 'Tambah kolom recipient_id',
      sql: `ALTER TABLE aduan ADD COLUMN recipient_id BIGINT UNSIGNED NULL AFTER recipient_role`,
    },
    {
      name: 'Tambah kolom forwarded_by',
      sql: `ALTER TABLE aduan ADD COLUMN forwarded_by BIGINT UNSIGNED NULL AFTER recipient_id`,
    },
    {
      name: 'Tambah kolom forwarded_at',
      sql: `ALTER TABLE aduan ADD COLUMN forwarded_at TIMESTAMP NULL AFTER forwarded_by`,
    },
    {
      name: 'Tambah kolom forwarded_from_role',
      sql: `ALTER TABLE aduan ADD COLUMN forwarded_from_role VARCHAR(50) NULL AFTER forwarded_at`,
    },
    {
      name: 'Buat tabel aduan_logs',
      sql: `CREATE TABLE IF NOT EXISTS aduan_logs (
        id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        aduan_id      BIGINT UNSIGNED NOT NULL,
        action        ENUM('created','responded','forwarded','status_changed') NOT NULL,
        actor_id      BIGINT UNSIGNED NOT NULL,
        actor_role    VARCHAR(50) NOT NULL,
        actor_name    VARCHAR(150) NULL,
        from_status   VARCHAR(50) NULL,
        to_status     VARCHAR(50) NULL,
        to_role       VARCHAR(50) NULL,
        to_admin_id   BIGINT UNSIGNED NULL,
        to_admin_name VARCHAR(150) NULL,
        notes         TEXT NULL,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_aduan_logs_aduan_id (aduan_id),
        CONSTRAINT fk_aduan_log_aduan FOREIGN KEY (aduan_id)
          REFERENCES aduan(id_aduan) ON DELETE CASCADE
      )`,
    },
  ];

  for (const step of steps) {
    try {
      await db.query(step.sql);
      console.log(`  ✅ ${step.name}`);
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_TABLE_EXISTS_ERROR') {
        console.log(`  ⚠️  ${step.name} → Sudah ada, di-skip.`);
      } else {
        console.error(`  ❌ ${step.name} → ${err.message}`);
      }
    }
  }

  const [cols] = await db.query('DESCRIBE aduan');
  console.log('\n📋 Final aduan columns:');
  cols.forEach(c => console.log(`   - ${c.Field} (${c.Type})`));

  const [logs] = await db.query('DESCRIBE aduan_logs');
  console.log('\n📋 aduan_logs columns:');
  logs.forEach(c => console.log(`   - ${c.Field} (${c.Type})`));

  console.log('\n✅ Migration selesai!');
  process.exit(0);
}

runMigration().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
