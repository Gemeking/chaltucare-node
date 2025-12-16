const express = require('express');
const { authenticate, authorizeDoctor } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/user', authenticate, (req, res) => {
  res.json({
    message: 'User access granted',
    user: req.user
  });
});

router.get('/doctor', authenticate, authorizeDoctor, (req, res) => {
  res.json({
    message: 'Doctor access granted'
  });
});

module.exports = router;
