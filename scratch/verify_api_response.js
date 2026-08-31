const db = require('../src/config/db');
const { getAdminKosAktifList, getAllKosForAdmin } = require('../src/controller/kos.controller');

// Mock req and res objects
function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(obj) {
      this.body = obj;
      return this;
    }
  };
  return res;
}

async function run() {
  try {
    const [desas] = await db.query('SELECT id FROM desa_adat LIMIT 1');
    const [banjars] = await db.query('SELECT id, desa_adat_id FROM banjar_adat LIMIT 1');

    const desaId = desas[0] ? desas[0].id : 1;
    const banjarId = banjars[0] ? banjars[0].id : 1;

    // Test getAdminKosAktifList
    const req1 = {
      user: { role: 'admin_desa', id: 1 },
      wilayahFilter: { desa_adat_id: desaId }
    };
    const res1 = mockRes();
    await getAdminKosAktifList(req1, res1);
    console.log('--- API: getAdminKosAktifList output ---');
    console.log('Success:', res1.body.success);
    console.log('Count:', res1.body.kos ? res1.body.kos.length : 0);
    if (res1.body.kos && res1.body.kos.length > 0) {
      console.log('First Kos Sample:', res1.body.kos[0]);
    }

    // Test getAllKosForAdmin
    const req2 = {
      user: { role: 'admin_desa', id: 1 },
      wilayahFilter: { desa_adat_id: desaId }
    };
    const res2 = mockRes();
    await getAllKosForAdmin(req2, res2);
    console.log('\n--- API: getAllKosForAdmin output ---');
    console.log('Success:', res2.body.success);
    console.log('Count:', res2.body.kos ? res2.body.kos.length : 0);
    if (res2.body.kos && res2.body.kos.length > 0) {
      const sample = res2.body.kos[0];
      console.log('First Kos Sample keys:', Object.keys(sample));
      console.log('Has harga_per_bulan / harga_sewa?', sample.harga_per_bulan !== undefined || sample.harga_sewa !== undefined);
      console.log('Sample data check (nama_kos, nama_pemilik):', { nama_kos: sample.nama_kos, nama_pemilik: sample.nama_pemilik });
    }

    process.exit(0);
  } catch (error) {
    console.error('API Verification error:', error);
    process.exit(1);
  }
}

run();
