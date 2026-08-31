// backend/src/routes/auth.routes.js
const express = require('express');
const router = express.Router();
const authController = require('../controller/auth.controller');
const { registerValidation, loginValidation } = require('../middleware/validation');
const { loginLimiter } = require('../middleware/rateLimiter');
const { verifyToken } = require('../middleware/authJWT');

// Public routes
router.post('/register', registerValidation, authController.register);
router.post('/login', loginLimiter, loginValidation, authController.login);
router.post('/refresh', authController.refreshToken);

// Protected routes
router.post('/logout', verifyToken, authController.logout);
router.get('/me', verifyToken, authController.me);
router.post('/switch-role', verifyToken, authController.switchRole);

module.exports = router;
