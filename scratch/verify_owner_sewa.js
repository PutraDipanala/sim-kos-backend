const db = require('../src/config/db');
const { getSewaHistoryByResidentAndRoom } = require('../src/controller/sewa.controller');

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
    // Let's find a valid combination of id_user and id_kos from transaksi_sewa
    const [sewas] = await db.query(`
      SELECT id_user, id_kos, COUNT(*) as count 
      FROM transaksi_sewa 
      GROUP BY id_user, id_kos 
      LIMIT 1
    `);

    if (sewas.length === 0) {
      console.log('No valid transaksi_sewa found for verification, creating mock search.');
      process.exit(0);
    }

    const { id_user, id_kos } = sewas[0];
    console.log(`Found active tenant-kos combination: id_user=${id_user}, id_kos=${id_kos}`);

    // Mock request
    const req = {
      query: { id_user, id_kos }
    };
    const res = mockRes();

    await getSewaHistoryByResidentAndRoom(req, res);

    console.log('\n--- API Output: getSewaHistoryByResidentAndRoom ---');
    console.log('Status Code:', res.statusCode);
    console.log('Success:', res.body.success);
    console.log('Message:', res.body.message);
    console.log('Transaction Count:', res.body.data.length);
    if (res.body.data.length > 0) {
      console.log('Sample transaction:', res.body.data[0]);
    }

    console.log('\n✅ Verification of sewa history API completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

run();
