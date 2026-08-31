// backend/scratch/test_aduan.js
const db = require('../src/config/db');
const aduanController = require('../src/controller/aduan.controller');

// Helper to mock express-validator validationResult
// We mock it so that it returns no errors (or we mock validation result behavior)
jestMocks();

function jestMocks() {
  // We override the validationResult import behavior inside the controller or mock it manually.
  // In our controller, we do: const errors = validationResult(req);
  // To avoid installing jest or complex testing frameworks, we can temporarily attach validationResult mock
  // to the require cache or simply ensure req has validationResult-like properties if validationResult allows it.
  // Actually, validationResult(req) gets errors from req.
  // Let's see how express-validator's validationResult works: it checks req[validationResultSymbol] or similar.
  // A simple way to mock it in our script is to define validationResult on the request or override require.
  const Module = require('module');
  const originalRequire = Module.prototype.require;
  Module.prototype.require = function (path) {
    if (path === 'express-validator') {
      return {
        validationResult: (req) => {
          return {
            isEmpty: () => !req.validationErrors || req.validationErrors.length === 0,
            array: () => req.validationErrors || [],
          };
        },
        body: () => {
          return {
            trim: () => ({
              isLength: () => ({ withMessage: () => ({ escape: () => ({}) }) }),
              isIn: () => ({ withMessage: () => ({}) }),
              notEmpty: () => ({ withMessage: () => ({ escape: () => ({}) }) }),
            }),
          };
        },
      };
    }
    return originalRequire.apply(this, arguments);
  };
}

// Re-require controller after mocking express-validator
const controller = require('../src/controller/aduan.controller');

async function runTests() {
  console.log('🧪 Starting Pusat Aspirasi Backend Tests...\n');

  let testUserCompletedId = null;
  let testUserIncompleteId = null;
  let testAdminDesa1Id = null;
  let testAdminDesa2Id = null;
  let testAdminBanjar1Id = null;
  let testSuperAdminId = null;
  let testAduanId1 = null;
  let testAduanId2 = null;

  try {
    // 1. Get valid desa_adat and banjar_adat IDs
    const [desas] = await db.query('SELECT id FROM desa_adat LIMIT 2');
    const [banjars] = await db.query('SELECT id FROM banjar_adat LIMIT 2');

    if (desas.length < 2 || banjars.length < 1) {
      throw new Error('Please ensure you have at least 2 desa_adat and 1 banjar_adat in the database.');
    }

    const idDesa1 = desas[0].id;
    const idDesa2 = desas[1].id;
    const idBanjar1 = banjars[0].id;

    console.log(`Using Desa Adat IDs: [${idDesa1}, ${idDesa2}] and Banjar Adat ID: [${idBanjar1}] for testing.`);

    // 2. Setup mock users
    // User 1: Completed profile
    const [u1] = await db.query(
      `INSERT INTO users (name, email, password_hash, role, profile_completed, desa_adat_id, banjar_adat_id, created_at)
       VALUES ('User Test Lengkap', 'usertest.complete@test.com', 'hash', 'user', 1, ?, ?, NOW())`,
      [idDesa1, idBanjar1]
    );
    testUserCompletedId = u1.insertId;

    // User 2: Incomplete profile
    const [u2] = await db.query(
      `INSERT INTO users (name, email, password_hash, role, profile_completed, desa_adat_id, banjar_adat_id, created_at)
       VALUES ('User Test Belum Lengkap', 'usertest.incomplete@test.com', 'hash', 'user', 0, ?, ?, NOW())`,
      [idDesa1, idBanjar1]
    );
    testUserIncompleteId = u2.insertId;

    // Admin Desa 1
    const [aDesa1] = await db.query(
      `INSERT INTO users (name, email, password_hash, role, profile_completed, desa_adat_id, banjar_adat_id, created_at)
       VALUES ('Admin Desa 1', 'admin.desa1@test.com', 'hash', 'admin_desa', 1, ?, NULL, NOW())`,
      [idDesa1]
    );
    testAdminDesa1Id = aDesa1.insertId;

    // Admin Desa 2
    const [aDesa2] = await db.query(
      `INSERT INTO users (name, email, password_hash, role, profile_completed, desa_adat_id, banjar_adat_id, created_at)
       VALUES ('Admin Desa 2', 'admin.desa2@test.com', 'hash', 'admin_desa', 1, ?, NULL, NOW())`,
      [idDesa2]
    );
    testAdminDesa2Id = aDesa2.insertId;

    // Admin Banjar 1
    const [aBanjar1] = await db.query(
      `INSERT INTO users (name, email, password_hash, role, profile_completed, desa_adat_id, banjar_adat_id, created_at)
       VALUES ('Admin Banjar 1', 'admin.banjar1@test.com', 'hash', 'admin_banjar', 1, ?, ?, NOW())`,
      [idDesa1, idBanjar1]
    );
    testAdminBanjar1Id = aBanjar1.insertId;

    // Super Admin
    const [aSuper] = await db.query(
      `INSERT INTO users (name, email, password_hash, role, profile_completed, created_at)
       VALUES ('Super Admin Test', 'superadmin@test.com', 'hash', 'super_admin', 1, NOW())`
    );
    testSuperAdminId = aSuper.insertId;

    console.log('✅ Mock users & admins created successfully.');

    // Helper to mock response object
    const makeRes = (onDone) => {
      let statusVal = 200;
      const resObj = {
        status: (s) => {
          statusVal = s;
          return resObj;
        },
        json: (data) => {
          onDone(statusVal, data);
        },
      };
      return resObj;
    };

    // ==========================================
    // TEST 1: POST /api/aduan (Profile Completed)
    // ==========================================
    console.log('\n--- TEST 1: POST /api/aduan (Profile Completed) ---');
    await new Promise((resolve, reject) => {
      const req = {
        user: { id: testUserCompletedId, role: 'user' },
        body: {
          judul: 'Jalanan Rusak di Banjar',
          deskripsi: 'Jalanan di dekat balai banjar mengalami kerusakan parah.',
          kategori: 'Kebijakan Desa',
        },
      };
      const res = makeRes((status, data) => {
        if (status === 201 && data.success) {
          testAduanId1 = data.data.id_aduan;
          console.log(`✅ Success: Aduan created (ID: ${testAduanId1}). Status: ${status}`);
          resolve();
        } else {
          reject(new Error(`Test 1 Failed. Status: ${status}, Msg: ${data.message}`));
        }
      });
      controller.createAduan(req, res).catch(reject);
    });

    // Create a second aduan for testing filtering (located in Desa 2)
    // We insert it directly since createAduan uses the user's desa_adat_id (which is idDesa1 for User 1)
    const [adv2] = await db.query(
      `INSERT INTO aduan (id_user, id_desa, id_banjar, judul, deskripsi, kategori, status, created_at, updated_at)
       VALUES (?, ?, NULL, 'Masalah Desa 2', 'Deskripsi masalah desa 2', 'Kebijakan Desa', 'menunggu', NOW(), NOW())`,
      [testUserCompletedId, idDesa2]
    );
    testAduanId2 = adv2.insertId;
    console.log(`Inserted aduan 2 (ID: ${testAduanId2}) directly in Desa 2.`);

    // ============================================
    // TEST 2: POST /api/aduan (Profile Incomplete)
    // ============================================
    console.log('\n--- TEST 2: POST /api/aduan (Profile Incomplete) ---');
    await new Promise((resolve, reject) => {
      const req = {
        user: { id: testUserIncompleteId, role: 'user' },
        body: {
          judul: 'Aduan User Belum Lengkap',
          deskripsi: 'Aduan ini seharusnya ditolak oleh sistem.',
          kategori: 'Kritik Sistem',
        },
      };
      const res = makeRes((status, data) => {
        if (status === 403 && !data.success) {
          console.log(`✅ Success: Correctly blocked with status 403. Msg: ${data.message}`);
          resolve();
        } else {
          reject(new Error(`Test 2 Failed. Expected 403 but got status ${status}`));
        }
      });
      controller.createAduan(req, res).catch(reject);
    });

    // ===========================================
    // TEST 3: GET /api/aduan (Admin Desa 1 Filter)
    // ===========================================
    console.log('\n--- TEST 3: GET /api/aduan (Admin Desa 1 Filter) ---');
    await new Promise((resolve, reject) => {
      const req = {
        user: { id: testAdminDesa1Id, role: 'admin_desa', desa_adat_id: idDesa1 },
        query: {},
      };
      const res = makeRes((status, data) => {
        if (status === 200 && data.success) {
          const hasOnlyDesa1 = data.data.every((ad) => ad.id_desa === idDesa1);
          const containsAduan1 = data.data.some((ad) => ad.id_aduan === testAduanId1);
          const containsAduan2 = data.data.some((ad) => ad.id_aduan === testAduanId2);

          if (hasOnlyDesa1 && containsAduan1 && !containsAduan2) {
            console.log(`✅ Success: Automatically filtered for Desa 1 (Got ${data.data.length} records).`);
            resolve();
          } else {
            reject(
              new Error(
                `Test 3 Failed. Filters incorrect. hasOnlyDesa1: ${hasOnlyDesa1}, containsAduan1: ${containsAduan1}, containsAduan2: ${containsAduan2}`
              )
            );
          }
        } else {
          reject(new Error(`Test 3 Failed. Status: ${status}, Msg: ${data.message}`));
        }
      });
      controller.getAduan(req, res).catch(reject);
    });

    // ===========================================
    // TEST 4: GET /api/aduan (Admin Desa 2 Filter)
    // ===========================================
    console.log('\n--- TEST 4: GET /api/aduan (Admin Desa 2 Filter) ---');
    await new Promise((resolve, reject) => {
      const req = {
        user: { id: testAdminDesa2Id, role: 'admin_desa', desa_adat_id: idDesa2 },
        query: {},
      };
      const res = makeRes((status, data) => {
        if (status === 200 && data.success) {
          const hasOnlyDesa2 = data.data.every((ad) => ad.id_desa === idDesa2);
          const containsAduan1 = data.data.some((ad) => ad.id_aduan === testAduanId1);
          const containsAduan2 = data.data.some((ad) => ad.id_aduan === testAduanId2);

          if (hasOnlyDesa2 && containsAduan2 && !containsAduan1) {
            console.log(`✅ Success: Automatically filtered for Desa 2 (Got ${data.data.length} records).`);
            resolve();
          } else {
            reject(
              new Error(
                `Test 4 Failed. Filters incorrect. hasOnlyDesa2: ${hasOnlyDesa2}, containsAduan1: ${containsAduan1}, containsAduan2: ${containsAduan2}`
              )
            );
          }
        } else {
          reject(new Error(`Test 4 Failed. Status: ${status}, Msg: ${data.message}`));
        }
      });
      controller.getAduan(req, res).catch(reject);
    });

    // ==========================================
    // TEST 5: GET /api/aduan (Super Admin view all)
    // ==========================================
    console.log('\n--- TEST 5: GET /api/aduan (Super Admin View All) ---');
    await new Promise((resolve, reject) => {
      const req = {
        user: { id: testSuperAdminId, role: 'super_admin' },
        query: {},
      };
      const res = makeRes((status, data) => {
        if (status === 200 && data.success) {
          const containsAduan1 = data.data.some((ad) => ad.id_aduan === testAduanId1);
          const containsAduan2 = data.data.some((ad) => ad.id_aduan === testAduanId2);

          if (containsAduan1 && containsAduan2) {
            console.log(`✅ Success: Super Admin can see all complaints (Total: ${data.data.length}).`);
            resolve();
          } else {
            reject(new Error('Test 5 Failed. Super Admin is missing some complaints.'));
          }
        } else {
          reject(new Error(`Test 5 Failed. Status: ${status}`));
        }
      });
      controller.getAduan(req, res).catch(reject);
    });

    // ========================================================
    // TEST 6: PUT /api/aduan/:id (Admin Desa 1 responds to Desa 1)
    // ========================================================
    console.log('\n--- TEST 6: PUT /api/aduan/:id (Admin Desa 1 responds to Desa 1) ---');
    await new Promise((resolve, reject) => {
      const req = {
        params: { id: testAduanId1 },
        user: { id: testAdminDesa1Id, role: 'admin_desa', desa_adat_id: idDesa1 },
        body: {
          tanggapan: 'Terima kasih atas masukannya. Jalan akan segera diperbaiki.',
          status: 'diproses',
        },
      };
      const res = makeRes((status, data) => {
        if (status === 200 && data.success) {
          console.log(`✅ Success: Response added. Status set to: ${data.data.status}`);
          resolve();
        } else {
          reject(new Error(`Test 6 Failed. Status: ${status}, Msg: ${data.message}`));
        }
      });
      controller.respondAduan(req, res).catch(reject);
    });

    // ========================================================
    // TEST 7: PUT /api/aduan/:id (Admin Desa 2 responds to Desa 1 - Unauthorized)
    // ========================================================
    console.log('\n--- TEST 7: PUT /api/aduan/:id (Admin Desa 2 responds to Desa 1 - Unauthorized) ---');
    await new Promise((resolve, reject) => {
      const req = {
        params: { id: testAduanId1 },
        user: { id: testAdminDesa2Id, role: 'admin_desa', desa_adat_id: idDesa2 },
        body: {
          tanggapan: 'Tanggapan ilegal.',
          status: 'selesai',
        },
      };
      const res = makeRes((status, data) => {
        if (status === 403 && !data.success) {
          console.log(`✅ Success: Correctly blocked unauthorized admin with 403. Msg: ${data.message}`);
          resolve();
        } else {
          reject(new Error(`Test 7 Failed. Expected 403 but got ${status}`));
        }
      });
      controller.respondAduan(req, res).catch(reject);
    });

    console.log('\n🎉 All tests passed successfully!');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
  } finally {
    // Cleanup mock data
    console.log('\n🧹 Cleaning up test data...');
    try {
      if (testAduanId1) await db.query('DELETE FROM aduan WHERE id_aduan = ?', [testAduanId1]);
      if (testAduanId2) await db.query('DELETE FROM aduan WHERE id_aduan = ?', [testAduanId2]);
      if (testUserCompletedId) await db.query('DELETE FROM users WHERE id = ?', [testUserCompletedId]);
      if (testUserIncompleteId) await db.query('DELETE FROM users WHERE id = ?', [testUserIncompleteId]);
      if (testAdminDesa1Id) await db.query('DELETE FROM users WHERE id = ?', [testAdminDesa1Id]);
      if (testAdminDesa2Id) await db.query('DELETE FROM users WHERE id = ?', [testAdminDesa2Id]);
      if (testAdminBanjar1Id) await db.query('DELETE FROM users WHERE id = ?', [testAdminBanjar1Id]);
      if (testSuperAdminId) await db.query('DELETE FROM users WHERE id = ?', [testSuperAdminId]);
      console.log('🧹 Cleanup completed.');
    } catch (cleanupError) {
      console.error('🧹 Error during cleanup:', cleanupError);
    }
    process.exit(0);
  }
}

runTests();
