const express = require('express');
const {
  register,
  verifyEmail,
  login,
  resendVerification
} = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', register);
router.get('/verify/:token', verifyEmail);
router.post('/login', login);
router.post('/resend-verification', resendVerification);

module.exports = router;
