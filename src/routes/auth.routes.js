const express = require('express');
const {
  register,
  verifyEmail,
  login,
  resendVerification,
  testEmail,
  getProfile,
  updateProfile,
  uploadProfilePicture,
  changePassword,
  deleteAccount,
  getUserStats
} = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../config/upload.config');

const router = express.Router();

// Public routes
router.post('/register', register);
router.get('/verify/:token', verifyEmail);
router.post('/login', login);
router.post('/resend-verification', resendVerification);
router.post('/test-email', testEmail);

// Protected routes (require authentication)
router.get('/profile', authMiddleware, getProfile);
router.put('/profile', authMiddleware, updateProfile);
router.post('/profile/picture', authMiddleware, upload.single('profile_picture'), uploadProfilePicture);
router.post('/change-password', authMiddleware, changePassword);
router.delete('/account', authMiddleware, deleteAccount);
router.get('/stats', authMiddleware, getUserStats);

module.exports = router;