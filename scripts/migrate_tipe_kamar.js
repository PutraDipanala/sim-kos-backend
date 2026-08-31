const db = require('../src/config/db');

async function runMigration() {
  console.log('=== STARTING MIGRATION: DYNAMIC ROOM TYPES ===');
  
  // Acquire a single connection to run the entire migration sequence
  const connection = await db.getConnection();
  
  try {
    // 1. Disable FK checks temporarily
    await connection.query('SET FOREIGN_KEY_CHECKS = 0');
    console.log('✔ Foreign key checks disabled.');

    // 2. Drop the old FK constraint
    try {
      await connection.query('ALTER TABLE transaksi_sewa DROP FOREIGN KEY fk_kamar');
      console.log('✔ Dropped old foreign key constraint fk_kamar from transaksi_sewa.');
    } catch (e) {
      console.log('ℹ Could not drop fk_kamar constraint (might not exist or already dropped):', e.message);
    }

    // 3. Clear new tables to ensure clean starting state (if any previous run left partial data)
    await connection.query('TRUNCATE TABLE kamar_fisik');
    await connection.query('DELETE FROM kamar_tipe');
    console.log('✔ Truncated kamar_fisik and cleared kamar_tipe tables.');

    // 4. Retrieve all existing kos
    const [kosList] = await connection.query('SELECT id, nama_kos, jumlah_kamar, harga_sewa FROM kos');
    console.log(`✔ Retrieved ${kosList.length} kos records for migration.`);

    const roomMapping = {}; // maps old kamar_kos.id -> new kamar_fisik.id

    // 5. Migrate each kos
    for (const kos of kosList) {
      console.log(`Migrating Kos: "${kos.nama_kos}" (ID: ${kos.id}, Kamar: ${kos.jumlah_kamar})`);
      
      // A. Create default 'Standar' type in kamar_tipe
      const [tipeResult] = await connection.query(
        'INSERT INTO kamar_tipe (id_kos, nama_tipe, harga_kamar, fasilitas) VALUES (?, ?, ?, ?)',
        [kos.id, 'Standar', kos.harga_sewa || 0, null]
      );
      const newTipeId = tipeResult.insertId;

      // B. Fetch existing rooms from kamar_kos for this kos
      const [oldRooms] = await connection.query(
        'SELECT id, nomor_kamar, status_ketersediaan FROM kamar_kos WHERE id_kos = ?',
        [kos.id]
      );

      if (oldRooms.length > 0) {
        // If old rooms exist, migrate them and record ID mapping
        for (const oldRoom of oldRooms) {
          const [fisikResult] = await connection.query(
            'INSERT INTO kamar_fisik (id_tipe, nomor_kamar, status_ketersediaan) VALUES (?, ?, ?)',
            [newTipeId, oldRoom.nomor_kamar, oldRoom.status_ketersediaan || 'tersedia']
          );
          roomMapping[oldRoom.id] = fisikResult.insertId;
        }
        console.log(`  - Migrated ${oldRooms.length} rooms from kamar_kos.`);
      } else {
        // If no old rooms exist, auto-generate sequential physical rooms based on kos.jumlah_kamar
        const roomCount = parseInt(kos.jumlah_kamar) || 0;
        if (roomCount > 0) {
          const roomValues = [];
          for (let i = 1; i <= roomCount; i++) {
            roomValues.push([newTipeId, String(i), 'tersedia']);
          }
          await connection.query(
            'INSERT INTO kamar_fisik (id_tipe, nomor_kamar, status_ketersediaan) VALUES ?',
            [roomValues]
          );
          console.log(`  - Generated ${roomCount} new rooms in kamar_fisik.`);
        } else {
          console.log(`  - No rooms generated (jumlah_kamar is 0).`);
        }
      }
    }

    // 6. Update transaksi_sewa.id_kamar mapping
    console.log('✔ Updating transaksi_sewa.id_kamar references...');
    let updateCount = 0;
    for (const [oldId, newId] of Object.entries(roomMapping)) {
      const [updateResult] = await connection.query(
        'UPDATE transaksi_sewa SET id_kamar = ? WHERE id_kamar = ?',
        [newId, parseInt(oldId)]
      );
      updateCount += updateResult.affectedRows;
    }
    console.log(`✔ Finished mapping rooms. Updated ${updateCount} rows in transaksi_sewa.`);

    // 7. Drop and rewrite database triggers
    console.log('✔ Rewriting MySQL triggers...');
    await connection.query('DROP TRIGGER IF EXISTS trg_sewa_after_update');
    await connection.query(`
      CREATE TRIGGER trg_sewa_after_update
      AFTER UPDATE ON transaksi_sewa
      FOR EACH ROW
      BEGIN
        IF NEW.status_kontrak IN ('selesai', 'batal') OR NEW.status_sewa = 'batal' THEN
          IF NEW.id_kamar IS NOT NULL THEN
            UPDATE kamar_fisik 
            SET status_ketersediaan = 'tersedia' 
            WHERE id = NEW.id_kamar;
          END IF;
        END IF;
      END
    `);
    console.log('  - Trigger trg_sewa_after_update updated.');

    await connection.query('DROP TRIGGER IF EXISTS trg_sewa_after_delete');
    await connection.query(`
      CREATE TRIGGER trg_sewa_after_delete
      AFTER DELETE ON transaksi_sewa
      FOR EACH ROW
      BEGIN
        IF OLD.id_kamar IS NOT NULL THEN
          UPDATE kamar_fisik 
          SET status_ketersediaan = 'tersedia' 
          WHERE id = OLD.id_kamar;
        END IF;
      END
    `);
    console.log('  - Trigger trg_sewa_after_delete updated.');

    // 8. Re-enable foreign key constraints & add new FK constraint
    console.log('✔ Adding new foreign key constraint on transaksi_sewa...');
    await connection.query(
      'ALTER TABLE transaksi_sewa ADD CONSTRAINT fk_kamar FOREIGN KEY (id_kamar) REFERENCES kamar_fisik(id) ON DELETE SET NULL'
    );
    console.log('✔ Foreign key constraint fk_kamar restored (referencing kamar_fisik).');

    await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('✔ Foreign key checks re-enabled.');
    console.log('=== MIGRATION COMPLETED SUCCESSFULLY ===');
    process.exit(0);

  } catch (error) {
    console.error('❌ Migration failed:', error);
    try {
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (_) {}
    process.exit(1);
  } finally {
    connection.release();
  }
}

runMigration();
