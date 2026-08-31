// backend/src/config/cron.js
const cron = require('node-cron');
const { generateTagihanInternal } = require('../controller/billing.controller');

// Jadwalkan pekerjaan pembuatan tagihan otomatis bulanan:
// Dijalankan pada tanggal 1 setiap bulan pukul 00:00 (Tengah Malam)
// Ekspresi Cron: '0 0 1 * *'
const monthlyBillingJob = cron.schedule('0 0 1 * *', async () => {
  console.log('[Cron Scheduler] 🕒 Menjalankan pekerjaan tagihan otomatis bulanan...');
  try {
    const results = await generateTagihanInternal();
    console.log('[Cron Scheduler] ✅ Pekerjaan tagihan otomatis sukses dijalankan:', results);
  } catch (error) {
    console.error('[Cron Scheduler] ❌ Pekerjaan tagihan otomatis gagal:', error);
  }
});

console.log('[Cron Scheduler] 🕒 Penjadwal tagihan otomatis bulanan terdaftar (0 0 1 * *).');

module.exports = {
  monthlyBillingJob
};
