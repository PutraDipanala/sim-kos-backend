const db = require('../src/config/db');

async function testQuery(user) {
  let whereConditions = [
    'k.deleted_at IS NULL',
    "k.status_aktif = 'aktif'",
    "k.status_verifikasi = 'terverifikasi'"
  ];
  let queryParams = [];

  if (user.role === 'admin_banjar') {
    whereConditions.push('k.desa_adat_id = ? AND k.banjar_adat_id = ?');
    queryParams.push(user.desa_adat_id, user.banjar_adat_id);
  } else if (user.role === 'admin_desa' || user.role === 'super_admin') {
    if (user.desa_adat_id) {
      whereConditions.push('k.desa_adat_id = ?');
      queryParams.push(user.desa_adat_id);
    }
  }

  const whereClause = 'WHERE ' + whereConditions.join(' AND ');

  const query = `
    SELECT 
      k.id AS kos_id,
      k.nama_kos,
      k.alamat_lengkap AS alamat,
      k.nama_pemilik,
      COUNT(CASE WHEN kf.status_ketersediaan = 'terisi' THEN 1 END) AS kamar_terisi
    FROM kos k
    LEFT JOIN kamar_tipe kt ON k.id = kt.id_kos
    LEFT JOIN kamar_fisik kf ON kt.id = kf.id_tipe
    ${whereClause}
    GROUP BY k.id
    ORDER BY k.nama_kos ASC
  `;

  console.log(`\n--- Test Kos Aktif for ${user.role} ---`);
  const [rows] = await db.query(query, queryParams);
  console.log('Results:', rows);
}

async function run() {
  try {
    const [desas] = await db.query('SELECT id FROM desa_adat LIMIT 1');
    const [banjars] = await db.query('SELECT id, desa_adat_id FROM banjar_adat LIMIT 1');

    const desaId = desas[0] ? desas[0].id : 1;
    const banjarId = banjars[0] ? banjars[0].id : 1;
    const banjarDesaId = banjars[0] ? banjars[0].desa_adat_id : 1;

    const mockAdminDesa = { role: 'admin_desa', desa_adat_id: desaId };
    const mockAdminBanjar = { role: 'admin_banjar', desa_adat_id: banjarDesaId, banjar_adat_id: banjarId };

    await testQuery(mockAdminDesa);
    await testQuery(mockAdminBanjar);

    console.log('\n✅ Verification of active kos query completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

run();
