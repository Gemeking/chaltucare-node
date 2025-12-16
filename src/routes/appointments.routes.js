const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db'); // PostgreSQL pool connection

// ------------------ CREATE / SCHEDULE APPOINTMENT ------------------
router.post('/create', async (req, res) => {
  try {
    const { user_id, doctor_id, scheduled_at } = req.body;
    const room_id = uuidv4(); // unique room for video chat

    const result = await pool.query(
      `INSERT INTO appointments (user_id, doctor_id, room_id, scheduled_at) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [user_id, doctor_id, room_id, scheduled_at]
    );

    res.json({ message: 'Appointment scheduled', appointment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------ VIEW OWN APPOINTMENTS (USER or DOCTOR) ------------------
router.get('/my-appointments/:user_id', async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT a.*, u.name AS user_name, d.name AS doctor_name
       FROM appointments a
       JOIN users u ON a.user_id = u.id
       JOIN users d ON a.doctor_id = d.id
       WHERE a.user_id = $1 OR a.doctor_id = $1
       ORDER BY scheduled_at ASC`,
      [user_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------ VIEW DOCTOR SCHEDULE ------------------
router.get('/doctor-schedule/:doctor_id', async (req, res) => {
  try {
    const { doctor_id } = req.params;

    const result = await pool.query(
      `SELECT a.*, u.name AS user_name
       FROM appointments a
       JOIN users u ON a.user_id = u.id
       WHERE a.doctor_id = $1
       ORDER BY scheduled_at ASC`,
      [doctor_id]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ------------------ CANCEL APPOINTMENT (USER OR DOCTOR) ------------------
router.post('/cancel/:appointment_id', async (req, res) => {
  try {
    const { appointment_id } = req.params;
    const { user_id } = req.body; // who requests cancellation

    // Only user or doctor can cancel
    const check = await pool.query(
      `SELECT * FROM appointments WHERE id=$1 AND (user_id=$2 OR doctor_id=$2)`,
      [appointment_id, user_id]
    );

    if (check.rowCount === 0) {
      return res.status(403).json({ message: 'Not authorized to cancel this appointment' });
    }

    const result = await pool.query(
      `UPDATE appointments SET status='cancelled' WHERE id=$1 RETURNING *`,
      [appointment_id]
    );

    res.json({ message: 'Appointment cancelled', appointment: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
