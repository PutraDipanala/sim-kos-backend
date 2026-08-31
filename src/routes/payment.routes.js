// backend/src/routes/payment.routes.js
const express           = require('express');
const router            = express.Router();
const paymentController = require('../controller/payment.controller');

/**
 * POST /api/payment/notification
 * ─────────────────────────────────────────────────────────────────────────────
 * Endpoint ini dipanggil OTOMATIS oleh server Midtrans (Webhook/HTTP Notification).
 *
 * ⚠️  PENTING — Pengaturan di Dashboard Midtrans:
 *   1. Login ke https://dashboard.sandbox.midtrans.com
 *   2. Masuk ke Settings → Configuration
 *   3. Isi "Payment Notification URL" dengan:
 *        https://DOMAIN_ANDA/api/payment/notification
 *      Jika masih local development, gunakan tunnel seperti ngrok:
 *        https://xxxx.ngrok.io/api/payment/notification
 *
 * ⚠️  Endpoint ini TIDAK butuh autentikasi JWT.
 *     Keamanan dijamin oleh verifikasi signature_key dari midtrans-client.
 */
router.post('/notification', paymentController.handleNotification);

/**
 * POST /api/payment/iuran-notification
 * ─────────────────────────────────────────────────────────────────────────────
 * Webhook Midtrans khusus untuk pembayaran iuran desa oleh pemilik kos.
 * Secara otomatis mengupdate tagihan_pemilik → status_pembayaran = 'lunas'.
 *
 * ⚠️  Daftarkan URL ini sebagai Finish Payment URL di Midtrans Dashboard.
 */
router.post('/iuran-notification', paymentController.handleIuranNotification);

module.exports = router;
