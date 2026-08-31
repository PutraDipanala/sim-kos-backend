const db = require('../src/config/db');

async function repairRooms() {
  console.log('=== STARTING ROOMS REPAIR SCRIPT ===');
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    // 1. Ambil semua kos yang tidak di-softdelete
    const [kosList] = await connection.query(
      'SELECT id, nama_kos, jumlah_kamar, harga_sewa FROM kos WHERE deleted_at IS NULL'
    );
    console.log(`Ditemukan ${kosList.length} properti kos di database.`);

    let totalFixedKos = 0;
    let totalAddedRooms = 0;

    for (const kos of kosList) {
      const targetCount = parseInt(kos.jumlah_kamar) || 0;
      if (targetCount <= 0) {
        console.log(`ℹ Kos "${kos.nama_kos}" (ID: ${kos.id}) memiliki jumlah_kamar = 0. Lewati.`);
        continue;
      }

      // A. Ambil tipe kamar untuk kos ini
      let [tipes] = await connection.query(
        'SELECT id, nama_tipe, harga_kamar FROM kamar_tipe WHERE id_kos = ?',
        [kos.id]
      );

      // Jika belum ada tipe sama sekali, buat tipe default 'Standar'
      let idTipe;
      if (tipes.length === 0) {
        console.log(`  -> Kos "${kos.nama_kos}" (ID: ${kos.id}) tidak memiliki tipe kamar. Membuat tipe 'Standar'...`);
        const [tipeResult] = await connection.query(
          'INSERT INTO kamar_tipe (id_kos, nama_tipe, harga_kamar) VALUES (?, \'Standar\', ?)',
          [kos.id, kos.harga_sewa || 0]
        );
        idTipe = tipeResult.insertId;
        // Re-fetch tipes
        tipes = [{ id: idTipe, nama_tipe: 'Standar' }];
      } else {
        idTipe = tipes[0].id; // Assign ke tipe pertama yang ditemukan
      }

      // B. Ambil kamar fisik yang ada saat ini
      const [currentRooms] = await connection.query(
        `SELECT kf.id, kf.nomor_kamar, kf.id_tipe 
         FROM kamar_fisik kf
         JOIN kamar_tipe kt ON kf.id_tipe = kt.id
         WHERE kt.id_kos = ?`,
        [kos.id]
      );

      const currentCount = currentRooms.length;

      if (currentCount < targetCount) {
        const missingCount = targetCount - currentCount;
        console.log(`⚠️  Kos "${kos.nama_kos}" (ID: ${kos.id}) kurang ${missingCount} kamar (Ada: ${currentCount}, Seharusnya: ${targetCount}). Memperbaiki...`);

        // Analisis penomoran kamar saat ini agar berurutan secara dinamis
        let maxNum = 0;
        let prefix = '';

        for (const r of currentRooms) {
          const match = r.nomor_kamar.match(/^([A-Za-z\-]*\s*)(\d+)$/);
          if (match) {
            const num = parseInt(match[2], 10);
            if (num > maxNum) {
              maxNum = num;
              prefix = match[1];
            }
          } else {
            const num = parseInt(r.nomor_kamar, 10);
            if (!isNaN(num) && num > maxNum) {
              maxNum = num;
            }
          }
        }

        // Jika tidak ada kamar fisik sama sekali, mulai dari 1
        if (currentCount === 0) {
          maxNum = 0;
          prefix = '';
        }

        // Pilihan tipe kamar untuk ditambahkan:
        // Utamakan tipe default 'Standar' jika ada, atau tipe pertama
        const targetTipe = tipes.find(t => t.nama_tipe.toLowerCase() === 'standar') || tipes[0];

        const roomValues = [];
        for (let i = 1; i <= missingCount; i++) {
          const nextNum = maxNum + i;
          const roomNum = `${prefix}${nextNum}`;
          roomValues.push([targetTipe.id, roomNum, 'tersedia']);
        }

        if (roomValues.length > 0) {
          await connection.query(
            'INSERT INTO kamar_fisik (id_tipe, nomor_kamar, status_ketersediaan) VALUES ?',
            [roomValues]
          );
          console.log(`   ✅ Ditambahkan ${missingCount} kamar ke tipe "${targetTipe.nama_tipe}" dengan format: ${prefix}${maxNum + 1} s/d ${prefix}${maxNum + missingCount}`);
          totalFixedKos++;
          totalAddedRooms += missingCount;
        }

      } else if (currentCount > targetCount) {
        console.log(`ℹ Kos "${kos.nama_kos}" (ID: ${kos.id}) memiliki lebih banyak kamar fisik daripada jumlah_kamar (Ada: ${currentCount}, Target: ${targetCount}). Tidak melakukan tindakan.`);
      } else {
        // Cocok
      }
    }

    await connection.commit();
    console.log('\n=== REPAIR SUCCESS ===');
    console.log(`Total Kos yang diperbaiki: ${totalFixedKos}`);
    console.log(`Total Kamar Fisik yang ditambahkan: ${totalAddedRooms}`);
    process.exit(0);

  } catch (error) {
    await connection.rollback();
    console.error('❌ Repair failed with error:', error);
    process.exit(1);
  } finally {
    connection.release();
  }
}

repairRooms();
