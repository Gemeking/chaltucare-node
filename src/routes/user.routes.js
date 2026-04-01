const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth.middleware');

// Get all users (excluding current user)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const currentUserId = req.user.id;
        
        const result = await pool.query(
            `SELECT id, name, email, role, is_verified, created_at 
             FROM users 
             WHERE id != $1
             ORDER BY name`,
            [currentUserId]
        );
        
        res.json(result.rows);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get all doctors
router.get('/role/doctors', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, name, email, role FROM users WHERE role = $1 ORDER BY name`,
            ['doctor']
        );
        res.json(result.rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get user by ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT id, name, email, role, is_verified, created_at 
             FROM users 
             WHERE id = $1`,
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;