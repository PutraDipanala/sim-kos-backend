const db = require('../src/config/db');
const { getOwnerArusKas } = require('../src/controller/kos.controller');

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(obj) { this.body = obj; return this; }
  };
  return res;
}

async function run() {
  try {
    // Test Juni 2026 (current month - should be empty but return availableMonths)
    const req = {
      user: { id: 6 },
      query: { kosId: '16', bulan: '6', tahun: '2026' }
    };
    const res = mockRes();
    await getOwnerArusKas(req, res);

    console.log('=== Juni 2026 (empty month) ===');
    console.log('Status:', res.statusCode);
    console.log('Items Count:', res.body.data.items.length);
    console.log('Summary:', res.body.data.summary);
    console.log('Available Months:', res.body.data.availableMonths);

    // Test Mei 2026 (has data)
    const req2 = {
      user: { id: 6 },
      query: { kosId: '16', bulan: '5', tahun: '2026' }
    };
    const res2 = mockRes();
    await getOwnerArusKas(req2, res2);

    console.log('\n=== Mei 2026 (month with data) ===');
    console.log('Status:', res2.statusCode);
    console.log('Items Count:', res2.body.data.items.length);
    console.log('Summary:', res2.body.data.summary);
    console.log('Available Months:', res2.body.data.availableMonths);

    // Test for user 12 (I Made Dipa) - Rahayu Residance
    const req3 = {
      user: { id: 12 },
      query: { kosId: '23', bulan: '6', tahun: '2026' }
    };
    const res3 = mockRes();
    await getOwnerArusKas(req3, res3);

    console.log('\n=== User 12 - Rahayu Residance - Juni 2026 ===');
    console.log('Status:', res3.statusCode);
    console.log('Items Count:', res3.body.data?.items?.length ?? 'N/A');
    console.log('Summary:', res3.body.data?.summary ?? 'N/A');
    console.log('Available Months:', res3.body.data?.availableMonths ?? 'N/A');

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

run();
