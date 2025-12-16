const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const pool = require('../config/db');

// ------------------ MULTER SETUP ------------------
const storage = multer.diskStorage({
  destination: 'uploads/payments/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ storage });

// ------------------ USER SUBMITS PAYMENT ------------------
router.post('/submit', upload.single('screenshot'), async (req, res) => {
  try {
    const { user_id, appointment_id } = req.body;
    const screenshot_path = `/uploads/payments/${req.file.filename}`;

    const result = await pool.query(
      `INSERT INTO payments (user_id, appointment_id, screenshot_path) 
       VALUES ($1, $2, $3) RETURNING *`,
      [user_id, appointment_id, screenshot_path]
    );

    res.json({
      message: 'Payment submitted successfully, pending approval.',
      payment: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------ DOCTOR VIEWS PENDING PAYMENTS ------------------
router.get('/pending/:doctor_id', async (req, res) => {
  try {
    const { doctor_id } = req.params;

    const result = await pool.query(
      `SELECT p.*, u.name AS user_name, a.scheduled_at
       FROM payments p
       JOIN users u ON p.user_id = u.id
       JOIN appointments a ON p.appointment_id = a.id
       WHERE p.status = 'pending'`
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------ DOCTOR APPROVES PAYMENT ------------------
router.post('/approve/:payment_id', async (req, res) => {
  try {
    const { payment_id } = req.params;
    const { doctor_id } = req.body;

    const result = await pool.query(
      `UPDATE payments
       SET status='approved', doctor_id=$1, reviewed_at=NOW()
       WHERE id=$2 RETURNING *`,
      [doctor_id, payment_id]
    );

    res.json({ message: 'Payment approved', payment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------ DOCTOR REJECTS PAYMENT ------------------
router.post('/reject/:payment_id', async (req, res) => {
  try {
    const { payment_id } = req.params;
    const { doctor_id, rejection_reason } = req.body;

    const result = await pool.query(
      `UPDATE payments
       SET status='rejected', doctor_id=$1, rejection_reason=$2, reviewed_at=NOW()
       WHERE id=$3 RETURNING *`,
      [doctor_id, rejection_reason, payment_id]
    );

    res.json({ message: 'Payment rejected', payment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
