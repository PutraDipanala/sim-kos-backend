-- ============================================================
-- Migration: Pusat Aspirasi - Eskalasi & Audit Log
-- Jalankan script ini di MySQL untuk menerapkan perubahan skema
-- ============================================================

-- 1. Tambah kolom baru di tabel aduan
ALTER TABLE aduan
  MODIFY COLUMN status ENUM('menunggu','diproses','selesai','diteruskan')
    NOT NULL DEFAULT 'menunggu',
  ADD COLUMN recipient_role ENUM('admin_banjar','admin_desa','super_admin')
    NULL AFTER id_banjar,
  ADD COLUMN recipient_id BIGINT UNSIGNED NULL AFTER recipient_role,
  ADD COLUMN forwarded_by BIGINT UNSIGNED NULL AFTER recipient_id,
  ADD COLUMN forwarded_at TIMESTAMP NULL AFTER forwarded_by,
  ADD COLUMN forwarded_from_role VARCHAR(50) NULL AFTER forwarded_at;

-- 2. Buat tabel audit log aduan
CREATE TABLE IF NOT EXISTS aduan_logs (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  aduan_id          BIGINT UNSIGNED NOT NULL,
  action            ENUM('created','responded','forwarded','status_changed') NOT NULL,
  actor_id          BIGINT UNSIGNED NOT NULL,
  actor_role        VARCHAR(50) NOT NULL,
  actor_name        VARCHAR(150) NULL,
  from_status       VARCHAR(50) NULL,
  to_status         VARCHAR(50) NULL,
  to_role           VARCHAR(50) NULL,
  to_admin_id       BIGINT UNSIGNED NULL,
  to_admin_name     VARCHAR(150) NULL,
  notes             TEXT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aduan_logs_aduan_id (aduan_id),
  CONSTRAINT fk_aduan_log_aduan
    FOREIGN KEY (aduan_id) REFERENCES aduan(id_aduan) ON DELETE CASCADE
);
