const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const authMiddleware = require('../middleware/auth.middleware');

// Apply auth middleware to all chat routes
router.use(authMiddleware);

// Get conversations for current user
router.get('/conversations', async (req, res) => {
    try {
        const userId = req.user.id;
        
        const query = `
            SELECT 
                c.*,
                CASE 
                    WHEN c.user1_id = $1 THEN u2.name
                    ELSE u1.name
                END as other_user_name,
                CASE 
                    WHEN c.user1_id = $1 THEN u2.id
                    ELSE u1.id
                END as other_user_id
            FROM conversations c
            JOIN users u1 ON u1.id = c.user1_id
            JOIN users u2 ON u2.id = c.user2_id
            WHERE c.user1_id = $1 OR c.user2_id = $1
            ORDER BY c.last_message_time DESC
        `;
        
        const result = await pool.query(query, [userId]);
        res.json({ conversations: result.rows });
    } catch (error) {
        console.error('Error getting conversations:', error);
        res.status(500).json({ error: error.message });
    }
});



const chatController = require('../controllers/chat.controller');

const upload = require('../config/upload.config');

// Apply auth middleware to all chat routes
router.use(authMiddleware);

// Send a message (with optional file)
router.post('/messages', chatController.sendMessage);

// Upload file endpoint
router.post('/upload', upload.single('file'), chatController.uploadFile);

// Get conversations
router.get('/conversations', chatController.getConversations);

// Get messages between users
router.get('/messages/:otherUserId', chatController.getMessages);

module.exports = router;
// Get messages between two users
router.get('/messages/:otherUserId', async (req, res) => {
    try {
        const userId = req.user.id;
        const { otherUserId } = req.params;
        
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
        
        const result = await pool.query(query, [userId, otherUserId]);
        
        // Mark messages as read
        await pool.query(
            `UPDATE messages 
             SET is_read = true 
             WHERE receiver_id = $1 AND sender_id = $2 AND is_read = false`,
            [userId, otherUserId]
        );
        
        // Return array directly
        res.json(result.rows);
    } catch (error) {
        console.error('Error getting messages:', error);
        res.status(500).json({ error: error.message });
    }
});

// Send a message
router.post('/messages', async (req, res) => {
    try {
        const { receiver_id, message } = req.body;
        const sender_id = req.user.id;
        
        if (!receiver_id) {
            return res.status(400).json({ error: 'Receiver ID is required' });
        }
        
        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }
        
        // Insert message
        const insertQuery = `
            INSERT INTO messages (sender_id, receiver_id, message)
            VALUES ($1, $2, $3)
            RETURNING *
        `;
        
        const result = await pool.query(insertQuery, [sender_id, receiver_id, message]);
        const newMessage = result.rows[0];
        
        // Update or create conversation
        const user1 = Math.min(sender_id, receiver_id);
        const user2 = Math.max(sender_id, receiver_id);
        
        const upsertQuery = `
            INSERT INTO conversations (user1_id, user2_id, last_message, last_message_time)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (user1_id, user2_id) 
            DO UPDATE SET 
                last_message = $3,
                last_message_time = CURRENT_TIMESTAMP,
                updated_at = CURRENT_TIMESTAMP
        `;
        
        await pool.query(upsertQuery, [user1, user2, message]);
        
        // Get user details
        const userQuery = 'SELECT id, name, email, role FROM users WHERE id = $1';
        const senderResult = await pool.query(userQuery, [sender_id]);
        
        const response = {
            ...newMessage,
            sender: senderResult.rows[0]
        };
        
        res.status(201).json(response);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;