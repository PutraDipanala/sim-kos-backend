const db = require('../src/config/db');

async function run() {
  try {
    // 1. Get room details for id = 19
    const [rooms] = await db.query(`
      SELECT kf.id as kamar_id, kf.nomor_kamar, kt.id as tipe_id, kt.nama_tipe, kt.id_kos, k.nama_kos
      FROM kamar_fisik kf
      JOIN kamar_tipe kt ON kf.id_tipe = kt.id
      JOIN kos k ON kt.id_kos = k.id
      WHERE kf.id = 19
    `);
    console.log('--- Room 19 Details ---');
    console.log(rooms);

    // 2. Let's see active KIPEMs for this room
    const [kipems] = await db.query(`
      SELECT pk.id_kipem, pk.id_user, pk.id_kos, pk.id_kamar_fisik, pk.status_kipem, pk.tanggal_masuk, pk.tanggal_keluar
      FROM penghuni_kipem pk
      WHERE pk.id_kamar_fisik = 19
    `);
    console.log('\n--- KIPEMs for Room 19 ---');
    console.log(kipems);

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
