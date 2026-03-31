const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// Test route
router.get('/test', (req, res) => {
    res.json({ message: 'Chat routes are working!' });
});

// Send a message
router.post('/messages', async (req, res) => {
    try {
        const { sender_id, receiver_id, message } = req.body;
        
        if (!sender_id || !receiver_id) {
            return res.status(400).json({ error: 'Sender ID and Receiver ID are required' });
        }
        
        const query = `
            INSERT INTO messages (sender_id, receiver_id, message)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        
        const result = await pool.query(query, [sender_id, receiver_id, message || null]);
        
        res.status(201).json({
            success: true,
            message: 'Message sent successfully',
            data: result.rows[0]
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get conversations for a user
router.get('/conversations/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const query = `
            SELECT 
                m.*,
                u_sender.name as sender_name,
                u_receiver.name as receiver_name
            FROM messages m
            JOIN users u_sender ON u_sender.id = m.sender_id
            JOIN users u_receiver ON u_receiver.id = m.receiver_id
            WHERE m.sender_id = $1 OR m.receiver_id = $1
            ORDER BY m.created_at DESC
            LIMIT 50
        `;
        
        const result = await pool.query(query, [userId]);
        
        res.json({
            success: true,
            count: result.rows.length,
            conversations: result.rows
        });
    } catch (error) {
        console.error('Error getting conversations:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get messages between two users
router.get('/messages/:user1/:user2', async (req, res) => {
    try {
        const { user1, user2 } = req.params;
        
        const query = `
            SELECT 
                m.*,
                u_sender.name as sender_name,
                u_receiver.name as receiver_name
            FROM messages m
            JOIN users u_sender ON u_sender.id = m.sender_id
            JOIN users u_receiver ON u_receiver.id = m.receiver_id
            WHERE (m.sender_id = $1 AND m.receiver_id = $2)
               OR (m.sender_id = $2 AND m.receiver_id = $1)
            ORDER BY m.created_at ASC
        `;
        
        const result = await pool.query(query, [user1, user2]);
        
        res.json({
            success: true,
            count: result.rows.length,
            messages: result.rows
        });
    } catch (error) {
        console.error('Error getting messages:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;