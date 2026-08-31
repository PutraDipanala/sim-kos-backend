// backend/src/middleware/validation.js
const { body } = require('express-validator');

exports.registerValidation = [
  body('name')
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage('Nama harus 3-100 karakter.')
    .escape(),

  body('email')
    .trim()
    .isEmail()
    .withMessage('Email tidak valid.')
    .normalizeEmail(),

  body('password')
    .isLength({ min: 8 })
    .withMessage('Password minimal 8 karakter.')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage(
      'Password harus mengandung huruf besar, huruf kecil, dan angka.'
    ),
];

exports.loginValidation = [
  body('email').trim().isEmail().withMessage('Email tidak valid.'),
  body('password').notEmpty().withMessage('Password wajib diisi.'),
];

exports.createAduanValidation = [
  body('judul')
    .trim()
    .isLength({ min: 5, max: 150 })
    .withMessage('Judul aduan harus berukuran 5-150 karakter.')
    .escape(),
  body('deskripsi')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Deskripsi aduan minimal 10 karakter.')
    .escape(),
  body('kategori')
    .trim()
    .isIn(['Kritik Sistem', 'Kebijakan Desa'])
    .withMessage('Kategori aduan tidak valid.'),
  body('id_desa')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('id_desa harus berupa bilangan bulat positif.'),
  body('id_banjar')
    .optional({ nullable: true })
    .isInt({ min: 1 })
    .withMessage('id_banjar harus berupa bilangan bulat positif.'),
];

exports.respondAduanValidation = [
  body('status')
    .trim()
    .isIn(['menunggu', 'diproses', 'selesai'])
    .withMessage('Status aduan tidak valid.'),
  body('tanggapan')
    .trim()
    .notEmpty()
    .withMessage('Tanggapan wajib diisi.')
    .escape()
];

exports.forwardAduanValidation = [
  body('target_role')
    .trim()
    .isIn(['admin_desa', 'super_admin'])
    .withMessage('target_role tidak valid. Harus admin_desa atau super_admin.'),
  body('notes')
    .optional({ nullable: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Catatan maksimal 500 karakter.')
    .escape(),
];

