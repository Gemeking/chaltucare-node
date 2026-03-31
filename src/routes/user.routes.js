const express = require('express');
const router = express.Router();

// Simple test route first (no auth)
router.get('/test', (req, res) => {
    res.json({ message: 'User routes are working!' });
});

// Get all users (simple version without auth for testing)
router.get('/', async (req, res) => {
    try {
        const pool = require('../config/db');
        const result = await pool.query('SELECT id, name, email, role FROM users');
        res.json(result.rows);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;