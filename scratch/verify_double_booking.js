const db = require('../src/config/db');
const { createSewa } = require('../src/controller/sewa.controller');

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
    // Let's find a user who has an active sewa
    const [sewas] = await db.query(`
      SELECT ts.id_user, ts.id_kos, ts.id_kamar 
      FROM transaksi_sewa ts
      WHERE ts.status_kontrak = 'aktif' AND ts.status_pembayaran = 'settlement'
      LIMIT 1
    `);

    if (sewas.length === 0) {
      console.log('No active sewa found to test double-booking prevention.');
      process.exit(0);
    }

    const activeSewa = sewas[0];
    console.log(`Testing with user who already has active contract: id_user=${activeSewa.id_user}`);

    // Let's attempt to create another sewa for the same user
    const req = {
      body: {
        id_user: activeSewa.id_user,
        id_kos: activeSewa.id_kos,
        id_kamar: activeSewa.id_kamar,
        id_tipe: 1, // Fallback room type
        tanggal_mulai_sewa: '2026-12-01',
        durasi_bulan: 3,
        total_harga: 1500000,
        tipe_pembayaran: 'bulanan'
      }
    };
    const res = mockRes();

    await createSewa(req, res);

    console.log('\n--- API Output: createSewa ---');
    console.log('Status Code:', res.statusCode);
    console.log('Success:', res.body.success);
    console.log('Message:', res.body.message);

    if (res.statusCode === 400 && res.body.success === false && res.body.message.includes('kontrak sewa aktif')) {
      console.log('\n✅ Double renting prevention verified successfully!');
      process.exit(0);
    } else {
      console.log('\n❌ Verification failed: API did not block double renting or returned incorrect message.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Verification script crashed:', error);
    process.exit(1);
  }
}

run();
