const db = require('../src/config/db');

async function testQueryKependudukan(user, month, year) {
  let whereConditions = [];
  let queryParams = [];

  if (user.role === 'admin_banjar') {
    whereConditions.push('pk.desa_adat_id = ? AND pk.banjar_adat_id = ?');
    queryParams.push(user.desa_adat_id, user.banjar_adat_id);
  } else if (user.role === 'admin_desa' || user.role === 'super_admin') {
    if (user.desa_adat_id) {
      whereConditions.push('pk.desa_adat_id = ?');
      queryParams.push(user.desa_adat_id);
    }
  }

  if (month && year) {
    const firstDayStr = `${year}-${String(month).padStart(2, '0')}-01`;
    whereConditions.push('pk.tanggal_masuk <= LAST_DAY(?) AND (pk.tanggal_keluar >= ? OR pk.tanggal_keluar IS NULL)');
    queryParams.push(firstDayStr, firstDayStr);
  }

  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

  const query = `
    SELECT 
      pk.id_kipem,
      CASE 
        WHEN pk.tanggal_keluar IS NULL OR pk.tanggal_keluar > CURDATE() THEN 'aktif'
        ELSE 'non_aktif'
      END AS status_kipem,
      pk.tanggal_terdaftar,
      pk.tanggal_masuk,
      pk.tanggal_keluar,
      u.name AS nama_penghuni,
      u.email AS email_penghuni,
      u.no_hp AS no_hp_penghuni,
      u.no_ktp AS no_ktp_penghuni,
      u.alamat_lengkap AS alamat_asal_penghuni,
      u.pekerjaan AS pekerjaan_penghuni,
      k.nama_kos,
      kf.nomor_kamar,
      kt.nama_tipe AS tipe_kamar,
      da.nama AS nama_desa,
      ba.nama AS nama_banjar
    FROM penghuni_kipem pk
    JOIN users u ON pk.id_user = u.id
    JOIN kos k ON pk.id_kos = k.id
    LEFT JOIN kamar_fisik kf ON pk.id_kamar_fisik = kf.id
    LEFT JOIN kamar_tipe kt ON kf.id_tipe = kt.id
    LEFT JOIN desa_adat da ON pk.desa_adat_id = da.id
    LEFT JOIN banjar_adat ba ON pk.banjar_adat_id = ba.id
    ${whereClause}
    ORDER BY pk.tanggal_masuk DESC
    LIMIT 5
  `;

  console.log(`\n--- Test Kependudukan for ${user.role} (month: ${month}, year: ${year}) ---`);
  console.log('Query params:', queryParams);
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

    // Test with June (6) 2026
    await testQueryKependudukan(mockAdminDesa, 6, 2026);
    await testQueryKependudukan(mockAdminBanjar, 6, 2026);

    console.log('\n✅ Verification of overlap demographic query completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

run();
