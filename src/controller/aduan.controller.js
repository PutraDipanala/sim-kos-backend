// backend/src/controller/aduan.controller.js
const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─── Helper: Insert Audit Log ───────────────────────────────────────────────
async function insertLog(aduanId, action, actor, extra = {}) {
  await db.query(
    `INSERT INTO aduan_logs
      (aduan_id, action, actor_id, actor_role, actor_name,
       from_status, to_status, to_role, to_admin_id, to_admin_name, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      aduanId,
      action,
      actor.id,
      actor.role,
      actor.name || null,
      extra.from_status || null,
      extra.to_status || null,
      extra.to_role || null,
      extra.to_admin_id || null,
      extra.to_admin_name || null,
      extra.notes || null,
    ]
  );
}

// ─── Helper: Find best recipient admin ─────────────────────────────────────
async function findRecipient(id_desa, id_banjar, kategori) {
  // 'Kebijakan Desa' → selalu ke level desa
  const usesBanjar = kategori !== 'Kebijakan Desa' && id_banjar;

  if (usesBanjar) {
    const [admins] = await db.query(
      `SELECT id, name FROM users WHERE role = 'admin_banjar' AND banjar_adat_id = ? LIMIT 1`,
      [id_banjar]
    );
    if (admins.length > 0) {
      return { role: 'admin_banjar', id: admins[0].id, name: admins[0].name };
    }
  }

  if (id_desa) {
    const [admins] = await db.query(
      `SELECT id, name FROM users WHERE role = 'admin_desa' AND desa_adat_id = ? LIMIT 1`,
      [id_desa]
    );
    if (admins.length > 0) {
      return { role: 'admin_desa', id: admins[0].id, name: admins[0].name };
    }
  }

  // Fallback ke super_admin
  const [admins] = await db.query(
    `SELECT id, name FROM users WHERE role = 'super_admin' LIMIT 1`
  );
  if (admins.length > 0) {
    return { role: 'super_admin', id: admins[0].id, name: admins[0].name };
  }

  return null;
}

/**
 * POST /api/aduan
 * Membuat aduan baru. Menerima id_desa & id_banjar opsional dari body untuk
 * menentukan tujuan lokasi aduan. Auto-routing recipient_id berdasarkan hirarki.
 */
exports.createAduan = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validasi input gagal.',
      errors: errors.array(),
    });
  }

  const { judul, deskripsi, kategori, id_desa: bodyDesa, id_banjar: bodyBanjar } = req.body;
  const userId = req.user.id;

  try {
    // 1. Validasi keaktifan & kelengkapan profil
    const [userRows] = await db.query(
      'SELECT id, name, profile_completed, desa_adat_id, banjar_adat_id FROM users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ success: false, message: 'User tidak ditemukan.' });
    }

    const user = userRows[0];
    if (user.profile_completed !== 1) {
      return res.status(403).json({
        success: false,
        message: 'Aduan tidak dapat dikirim. Anda harus melengkapi profil terlebih dahulu.',
      });
    }

    // 2. Tentukan lokasi target: gunakan pilihan user dari form, fallback ke profil
    let targetDesa = bodyDesa ? parseInt(bodyDesa, 10) : user.desa_adat_id;
    let targetBanjar = bodyBanjar ? parseInt(bodyBanjar, 10) : user.banjar_adat_id;

    // Kebijakan Desa tidak boleh dikirim ke level banjar
    if (kategori === 'Kebijakan Desa') {
      targetBanjar = null;
    }

    // 3. Auto-routing: cari admin penerima berdasarkan hirarki
    const recipient = await findRecipient(targetDesa, targetBanjar, kategori);

    // 4. Simpan aduan
    const [result] = await db.query(
      `INSERT INTO aduan
        (id_user, id_desa, id_banjar, recipient_role, recipient_id,
         judul, deskripsi, kategori, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'menunggu', NOW(), NOW())`,
      [
        userId,
        targetDesa || null,
        targetBanjar || null,
        recipient ? recipient.role : null,
        recipient ? recipient.id : null,
        judul,
        deskripsi,
        kategori,
      ]
    );

    const newAduanId = result.insertId;

    // 5. Insert audit log
    await insertLog(newAduanId, 'created', { id: userId, role: 'user', name: user.name }, {
      to_status: 'menunggu',
      to_role: recipient ? recipient.role : null,
      to_admin_id: recipient ? recipient.id : null,
      to_admin_name: recipient ? recipient.name : null,
    });

    return res.status(201).json({
      success: true,
      message: 'Aduan berhasil dikirim.',
      data: {
        id_aduan: newAduanId,
        id_user: userId,
        id_desa: targetDesa,
        id_banjar: targetBanjar,
        recipient_role: recipient ? recipient.role : null,
        judul,
        deskripsi,
        kategori,
        status: 'menunggu',
        created_at: new Date(),
      },
    });
  } catch (error) {
    console.error('❌ Error createAduan:', error);
    return res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server saat menyimpan aduan.',
      error: error.message,
    });
  }
};

/**
 * GET /api/aduan
 * Mengambil daftar aduan dengan filter wilayah & role.
 * admin_banjar: hanya aduan di banjarnya yang BELUM diteruskan
 * admin_desa:   aduan di desanya (termasuk yang diteruskan dari banjar)
 * super_admin:  semua aduan (termasuk yang diteruskan dari desa)
 * user biasa:   aduan milik sendiri
 */
exports.getAduan = async (req, res) => {
  try {
    const user = req.user;
    let conditions = [];
    let params = [];

    if (user.role === 'admin_banjar') {
      if (!user.banjar_adat_id) {
        return res.status(403).json({ success: false, message: 'Admin banjar tidak memiliki banjar_adat_id yang valid.' });
      }
      // Melihat aduan yang ditujukan ke banjarnya (termasuk yang masuk langsung)
      conditions.push('(a.id_banjar = ? AND a.status != ?)');
      params.push(user.banjar_adat_id, 'diteruskan');
    } else if (user.role === 'admin_desa') {
      if (!user.desa_adat_id) {
        return res.status(403).json({ success: false, message: 'Admin desa tidak memiliki desa_adat_id yang valid.' });
      }
      // Melihat aduan di desanya: langsung ke desa ATAU diteruskan dari banjar ke desa
      conditions.push('(a.id_desa = ? AND (a.recipient_role = ? OR a.recipient_role IS NULL OR a.id_banjar IS NULL OR a.status = ?))');
      params.push(user.desa_adat_id, 'admin_desa', 'diteruskan');
    } else if (user.role === 'super_admin' || user.role === 'admin') {
      // Super admin melihat semua aduan yang diteruskan ke mereka + aduan tanpa wilayah spesifik
      // atau semua jika super_admin tidak punya filter wilayah
    } else {
      // User biasa / pemilikKos hanya lihat aduannya sendiri
      conditions.push('a.id_user = ?');
      params.push(user.id);
    }

    // Filter opsional via query params
    const { status, kategori } = req.query;
    if (status) { conditions.push('a.status = ?'); params.push(status); }
    if (kategori) { conditions.push('a.kategori = ?'); params.push(kategori); }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT
        a.id_aduan,
        a.id_user,
        a.id_desa,
        a.id_banjar,
        a.judul,
        a.deskripsi,
        a.kategori,
        a.status,
        a.tanggapan,
        a.recipient_role,
        a.recipient_id,
        a.forwarded_by,
        a.forwarded_at,
        a.forwarded_from_role,
        a.created_at,
        a.updated_at,
        u.name   AS nama_pengirim,
        u.email  AS email_pengirim,
        da.nama  AS nama_desa,
        ba.nama  AS nama_banjar,
        fw.name  AS forwarded_by_name
      FROM aduan a
      LEFT JOIN users u  ON a.id_user = u.id
      LEFT JOIN desa_adat da   ON a.id_desa   = da.id
      LEFT JOIN banjar_adat ba ON a.id_banjar  = ba.id
      LEFT JOIN users fw ON a.forwarded_by = fw.id
      ${whereClause}
      ORDER BY a.created_at DESC
    `;

    const [rows] = await db.query(query, params);

    return res.json({ success: true, message: 'Data aduan berhasil dimuat.', data: rows });
  } catch (error) {
    console.error('❌ Error getAduan:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server saat memuat aduan.', error: error.message });
  }
};

/**
 * PUT /api/aduan/:id
 * Admin menanggapi aduan dan mengubah status.
 */
exports.respondAduan = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validasi input gagal.', errors: errors.array() });
  }

  const { id } = req.params;
  const { tanggapan, status } = req.body;
  const user = req.user;

  try {
    const [aduanRows] = await db.query('SELECT * FROM aduan WHERE id_aduan = ?', [id]);
    if (aduanRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Aduan tidak ditemukan.' });
    }

    const aduan = aduanRows[0];
    const oldStatus = aduan.status;

    // Validasi otoritas wilayah
    if (user.role === 'admin_desa') {
      if (aduan.id_desa !== user.desa_adat_id) {
        return res.status(403).json({ success: false, message: 'Akses ditolak. Anda hanya diperbolehkan menanggapi aduan di wilayah desa Anda.' });
      }
    } else if (user.role === 'admin_banjar') {
      if (aduan.id_banjar !== user.banjar_adat_id) {
        return res.status(403).json({ success: false, message: 'Akses ditolak. Anda hanya diperbolehkan menanggapi aduan di wilayah banjar Anda.' });
      }
    } else if (user.role !== 'super_admin' && user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Anda tidak memiliki wewenang untuk menanggapi aduan.' });
    }

    await db.query(
      `UPDATE aduan SET tanggapan = ?, status = ?, updated_at = NOW() WHERE id_aduan = ?`,
      [tanggapan, status, id]
    );

    // Ambil nama admin dari DB untuk log
    const [actorRows] = await db.query('SELECT name FROM users WHERE id = ?', [user.id]);
    const actorName = actorRows[0]?.name || null;

    // Insert audit log
    await insertLog(id, 'responded', { id: user.id, role: user.role, name: actorName }, {
      from_status: oldStatus,
      to_status: status,
      notes: tanggapan,
    });

    const [updatedRows] = await db.query(
      `SELECT a.id_aduan, a.id_user, a.id_desa, a.id_banjar, a.judul, a.deskripsi,
              a.kategori, a.status, a.tanggapan, a.created_at, a.updated_at,
              u.name AS nama_pengirim, da.nama AS nama_desa, ba.nama AS nama_banjar
       FROM aduan a
       LEFT JOIN users u ON a.id_user = u.id
       LEFT JOIN desa_adat da ON a.id_desa = da.id
       LEFT JOIN banjar_adat ba ON a.id_banjar = ba.id
       WHERE a.id_aduan = ?`,
      [id]
    );

    return res.json({ success: true, message: 'Tanggapan aduan berhasil disimpan.', data: updatedRows[0] });
  } catch (error) {
    console.error('❌ Error respondAduan:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server saat menanggapi aduan.', error: error.message });
  }
};

/**
 * POST /api/aduan/:id/forward
 * Eskalasi / forward aduan ke level admin yang lebih tinggi.
 * admin_banjar → admin_desa
 * admin_desa   → super_admin
 */
exports.forwardAduan = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Validasi input gagal.', errors: errors.array() });
  }

  const { id } = req.params;
  const { target_role, notes } = req.body;
  const user = req.user;

  try {
    // 1. Validasi: hanya admin_banjar dan admin_desa yang bisa forward
    if (user.role === 'admin_banjar' && target_role !== 'admin_desa') {
      return res.status(403).json({ success: false, message: 'Admin Banjar hanya bisa meneruskan ke Admin Desa.' });
    }
    if (user.role === 'admin_desa' && target_role !== 'super_admin') {
      return res.status(403).json({ success: false, message: 'Admin Desa hanya bisa meneruskan ke Super Admin.' });
    }
    if (user.role !== 'admin_banjar' && user.role !== 'admin_desa') {
      return res.status(403).json({ success: false, message: 'Hanya Admin Banjar atau Admin Desa yang dapat meneruskan aduan.' });
    }

    // 2. Ambil aduan
    const [aduanRows] = await db.query('SELECT * FROM aduan WHERE id_aduan = ?', [id]);
    if (aduanRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Aduan tidak ditemukan.' });
    }

    const aduan = aduanRows[0];

    // 3. Validasi kepemilikan wilayah
    if (user.role === 'admin_banjar' && aduan.id_banjar !== user.banjar_adat_id) {
      return res.status(403).json({ success: false, message: 'Anda hanya bisa meneruskan aduan di wilayah banjar Anda.' });
    }
    if (user.role === 'admin_desa' && aduan.id_desa !== user.desa_adat_id) {
      return res.status(403).json({ success: false, message: 'Anda hanya bisa meneruskan aduan di wilayah desa Anda.' });
    }

    // 4. Cegah forward ulang jika sudah diteruskan
    if (aduan.status === 'diteruskan') {
      return res.status(400).json({ success: false, message: 'Aduan ini sudah pernah diteruskan.' });
    }
    if (aduan.status === 'selesai') {
      return res.status(400).json({ success: false, message: 'Aduan yang sudah selesai tidak dapat diteruskan.' });
    }

    // 5. Temukan admin tujuan
    let targetAdmin = null;
    if (target_role === 'admin_desa') {
      const [rows] = await db.query(
        `SELECT id, name FROM users WHERE role = 'admin_desa' AND desa_adat_id = ? LIMIT 1`,
        [aduan.id_desa]
      );
      targetAdmin = rows[0] || null;
    } else if (target_role === 'super_admin') {
      const [rows] = await db.query(`SELECT id, name FROM users WHERE role = 'super_admin' LIMIT 1`);
      targetAdmin = rows[0] || null;
    }

    // 6. Ambil nama actor
    const [actorRows] = await db.query('SELECT name FROM users WHERE id = ?', [user.id]);
    const actorName = actorRows[0]?.name || null;

    // 7. Update aduan: status diteruskan, set recipient baru, clear banjar jika forward ke desa/super
    const updateFields = {
      status: 'diteruskan',
      recipient_role: target_role,
      recipient_id: targetAdmin ? targetAdmin.id : null,
      forwarded_by: user.id,
      forwarded_at: new Date(),
      forwarded_from_role: user.role,
    };

    // Jika forward ke desa atau super, hapus id_banjar agar tidak muncul di banjar lagi
    if (target_role === 'admin_desa' || target_role === 'super_admin') {
      updateFields.id_banjar = null;
    }

    await db.query(
      `UPDATE aduan SET
        status = ?, recipient_role = ?, recipient_id = ?,
        forwarded_by = ?, forwarded_at = ?, forwarded_from_role = ?,
        id_banjar = ?, updated_at = NOW()
       WHERE id_aduan = ?`,
      [
        updateFields.status,
        updateFields.recipient_role,
        updateFields.recipient_id,
        updateFields.forwarded_by,
        updateFields.forwarded_at,
        updateFields.forwarded_from_role,
        target_role === 'super_admin' ? null : (target_role === 'admin_desa' ? null : aduan.id_banjar),
        id,
      ]
    );

    // 8. Insert audit log
    await insertLog(id, 'forwarded', { id: user.id, role: user.role, name: actorName }, {
      from_status: aduan.status,
      to_status: 'diteruskan',
      to_role: target_role,
      to_admin_id: targetAdmin ? targetAdmin.id : null,
      to_admin_name: targetAdmin ? targetAdmin.name : null,
      notes: notes || null,
    });

    return res.json({
      success: true,
      message: `Aduan berhasil diteruskan ke ${target_role === 'admin_desa' ? 'Admin Desa' : 'Super Admin'}.`,
      data: {
        id_aduan: parseInt(id),
        forwarded_to_role: target_role,
        forwarded_to_name: targetAdmin ? targetAdmin.name : 'Super Admin',
        forwarded_at: updateFields.forwarded_at,
      },
    });
  } catch (error) {
    console.error('❌ Error forwardAduan:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server saat meneruskan aduan.', error: error.message });
  }
};

/**
 * GET /api/aduan/:id/logs
 * Mengambil riwayat audit log dari sebuah aduan.
 * Hanya bisa diakses oleh admin yang memiliki akses ke aduan tersebut,
 * atau oleh pemilik aduan itu sendiri.
 */
exports.getAduanLogs = async (req, res) => {
  const { id } = req.params;
  const user = req.user;

  try {
    // Validasi aduan ada
    const [aduanRows] = await db.query('SELECT * FROM aduan WHERE id_aduan = ?', [id]);
    if (aduanRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Aduan tidak ditemukan.' });
    }

    const aduan = aduanRows[0];

    // Cek akses: pemilik aduan atau admin yang relevan
    const isOwner = aduan.id_user === user.id;
    const isAdminBanjar = user.role === 'admin_banjar';
    const isAdminDesa = user.role === 'admin_desa';
    const isSuperAdmin = user.role === 'super_admin' || user.role === 'admin';

    if (!isOwner && !isAdminBanjar && !isAdminDesa && !isSuperAdmin) {
      return res.status(403).json({ success: false, message: 'Akses ditolak.' });
    }

    const [logs] = await db.query(
      `SELECT al.*, u.name AS actor_display_name
       FROM aduan_logs al
       LEFT JOIN users u ON al.actor_id = u.id
       WHERE al.aduan_id = ?
       ORDER BY al.created_at ASC`,
      [id]
    );

    return res.json({ success: true, data: logs });
  } catch (error) {
    console.error('❌ Error getAduanLogs:', error);
    return res.status(500).json({ success: false, message: 'Terjadi kesalahan server.', error: error.message });
  }
};
