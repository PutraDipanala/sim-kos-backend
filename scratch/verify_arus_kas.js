const db = require('../src/config/db');
const { getOwnerArusKas } = require('../src/controller/kos.controller');

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
    // Let's find an owner user who owns a kos
    const [owners] = await db.query(`
      SELECT k.id as kos_id, k.created_by as user_id 
      FROM kos k 
      WHERE k.created_by IS NOT NULL 
      LIMIT 1
    `);

    if (owners.length === 0) {
      console.log('No owners with kos found in database.');
      process.exit(0);
    }

    const { kos_id, user_id } = owners[0];
    console.log(`Found owner: user_id=${user_id}, kos_id=${kos_id}`);

    // Let's find any transaction dates for this kos
    const [txs] = await db.query(`
      SELECT created_at FROM transaksi_sewa WHERE id_kos = ? LIMIT 1
    `, [kos_id]);

    let bulan = new Date().getMonth() + 1;
    let tahun = new Date().getFullYear();

    if (txs.length > 0) {
      const date = new Date(txs[0].created_at);
      bulan = date.getMonth() + 1;
      tahun = date.getFullYear();
    }

    console.log(`Testing query for Month=${bulan}, Year=${tahun}`);

    const req = {
      user: { id: user_id },
      query: {
        kosId: kos_id,
        bulan: bulan.toString(),
        tahun: tahun.toString()
      }
    };
    const res = mockRes();

    await getOwnerArusKas(req, res);

    console.log('\n--- API Output: getOwnerArusKas ---');
    console.log('Status Code:', res.statusCode);
    console.log('Success:', res.body.success);
    if (res.body.success) {
      console.log('Kos Name:', res.body.data.kos.nama_kos);
      console.log('Cash Flow Items Count:', res.body.data.items.length);
      console.log('Summary:', res.body.data.summary);
      if (res.body.data.items.length > 0) {
        console.log('Sample item:', res.body.data.items[0]);
      }
    } else {
      console.log('Message:', res.body.message);
    }

    console.log('\n✅ Cash flow report API verified successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  }
}

run();
