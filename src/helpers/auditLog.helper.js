// backend/src/helpers/auditLog.helper.js

const db = require('../config/db');

/**
 * Save audit log ke tabel kos_audit_log
 * 
 * @param {Object} params - Parameter audit log
 * @param {number} params.kos_id - ID kos yang diubah
 * @param {number} params.user_id - ID user yang melakukan aksi
 * @param {string} params.action - Jenis aksi: 'create'|'update'|'verify'|'reject'|'deactivate'
 * @param {string} params.field_changed - Nama field yang berubah (opsional)
 * @param {string} params.old_value - Nilai lama (opsional)
 * @param {string} params.new_value - Nilai baru (opsional)
 */
const saveAuditLog = async ({ kos_id, user_id, action, field_changed = null, old_value = null, new_value = null }) => {
  try {
    const query = `
      INSERT INTO kos_audit_log 
      (kos_id, user_id, action, field_changed, old_value, new_value, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
    `;

    const [result] = await db.query(query, [
      kos_id,
      user_id,
      action,
      field_changed,
      old_value,
      new_value
    ]);

    console.log(`✅ Audit log saved: ${action} on kos ${kos_id} by user ${user_id}`);
    return result;
  } catch (error) {
    console.error('❌ Error saving audit log:', error);
    // Jangan throw error, karena audit log failure tidak boleh block main operation
    return null;
  }
};

/**
 * Get audit logs untuk 1 kos tertentu
 * 
 * @param {number} kos_id - ID kos
 * @param {number} limit - Jumlah log yang diambil (default: 50)
 * @returns {Array} Array of audit log objects
 */
const getKosAuditLogs = async (kos_id, limit = 50) => {
  try {
    const query = `
      SELECT 
        kal.id,
        kal.action,
        kal.field_changed,
        kal.old_value,
        kal.new_value,
        kal.changed_at,
        u.name as user_name,
        u.role as user_role
      FROM kos_audit_log kal
      LEFT JOIN users u ON kal.user_id = u.id
      WHERE kal.kos_id = ?
      ORDER BY kal.changed_at DESC
      LIMIT ?
    `;

    const [logs] = await db.query(query, [kos_id, limit]);
    return logs;
  } catch (error) {
    console.error('❌ Error fetching audit logs:', error);
    return [];
  }
};

/**
 * Format audit log untuk display di frontend
 * 
 * @param {Array} logs - Array of raw audit logs
 * @returns {Array} Formatted logs dengan deskripsi human-readable
 */
const formatAuditLogs = (logs) => {
  const actionLabels = {
    create: 'Kos dibuat',
    update: 'Data diubah',
    verify: 'Kos disetujui',
    reject: 'Kos ditolak',
    deactivate: 'Kos dinonaktifkan'
  };

  return logs.map(log => {
    let description = actionLabels[log.action] || log.action;

    // Tambah detail perubahan jika ada
    if (log.field_changed && log.old_value && log.new_value) {
      description += `: ${log.field_changed} dari "${log.old_value}" menjadi "${log.new_value}"`;
    }

    return {
      id: log.id,
      action: log.action,
      description,
      user_name: log.user_name,
      user_role: log.user_role,
      changed_at: log.changed_at
    };
  });
};

module.exports = {
  saveAuditLog,
  getKosAuditLogs,
  formatAuditLogs
};