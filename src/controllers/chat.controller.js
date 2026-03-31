const pool = require('../config/db');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

class ChatController {
    // Send a message
    async sendMessage(req, res) {
        try {
            const { receiver_id, message, file } = req.body;
            const sender_id = req.user.id;

            if (!receiver_id) {
                return res.status(400).json({ error: 'Receiver ID is required' });
            }

            if (!message && !file) {
                return res.status(400).json({ error: 'Message or file is required' });
            }

            const client = await pool.connect();
            
            try {
                await client.query('BEGIN');

                // Insert message
                const query = `
                    INSERT INTO messages (sender_id, receiver_id, message, file_url, file_name, file_type, file_size)
                    VALUES ($1, $2, $3, $4, $5, $6, $7)
                    RETURNING *
                `;
                
                const values = [
                    sender_id, 
                    receiver_id, 
                    message || null,
                    file?.url || null,
                    file?.name || null,
                    file?.type || null,
                    file?.size || null
                ];
                
                const result = await client.query(query, values);
                const newMessage = result.rows[0];

                // Update or create conversation
                const user1 = Math.min(sender_id, receiver_id);
                const user2 = Math.max(sender_id, receiver_id);
                
                const updateConversationQuery = `
                    INSERT INTO conversations (user1_id, user2_id, last_message, last_message_time)
                    VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                    ON CONFLICT (user1_id, user2_id) 
                    DO UPDATE SET 
                        last_message = $3,
                        last_message_time = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING *
                `;
                
                await client.query(updateConversationQuery, [user1, user2, message || '📎 File attached']);

                await client.query('COMMIT');

                // Get user details for response
                const userQuery = 'SELECT id, name, email, role FROM users WHERE id = $1';
                const senderResult = await client.query(userQuery, [sender_id]);
                const receiverResult = await client.query(userQuery, [receiver_id]);

                const response = {
                    ...newMessage,
                    sender: senderResult.rows[0],
                    receiver: receiverResult.rows[0]
                };

                res.status(201).json(response);
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({ error: 'Failed to send message' });
        }
    }

    // Get conversations for a user
    async getConversations(req, res) {
        try {
            const userId = req.user.id;
            
            const query = `
                SELECT 
                    c.*,
                    CASE 
                        WHEN c.user1_id = $1 THEN u2.id
                        ELSE u1.id
                    END as other_user_id,
                    CASE 
                        WHEN c.user1_id = $1 THEN u2.name
                        ELSE u1.name
                    END as other_user_name,
                    CASE 
                        WHEN c.user1_id = $1 THEN u2.email
                        ELSE u1.email
                    END as other_user_email,
                    CASE 
                        WHEN c.user1_id = $1 THEN u2.role
                        ELSE u1.role
                    END as other_user_role,
                    CASE 
                        WHEN c.user1_id = $1 THEN c.user1_unread_count
                        ELSE c.user2_unread_count
                    END as unread_count
                FROM conversations c
                JOIN users u1 ON u1.id = c.user1_id
                JOIN users u2 ON u2.id = c.user2_id
                WHERE c.user1_id = $1 OR c.user2_id = $1
                ORDER BY c.last_message_time DESC
            `;
            
            const result = await pool.query(query, [userId]);
            res.json(result.rows);
        } catch (error) {
            console.error('Error getting conversations:', error);
            res.status(500).json({ error: 'Failed to get conversations' });
        }
    }

    // Get messages between two users
    async getMessages(req, res) {
        try {
            const userId = req.user.id;
            const { otherUserId } = req.params;
            const { limit = 50, offset = 0 } = req.query;
            
            // Verify that the user is part of this conversation
            const verifyQuery = `
                SELECT * FROM messages 
                WHERE (sender_id = $1 AND receiver_id = $2) 
                   OR (sender_id = $2 AND receiver_id = $1)
                LIMIT 1
            `;
            
            const verifyResult = await pool.query(verifyQuery, [userId, otherUserId]);
            
            if (verifyResult.rows.length === 0 && userId != otherUserId) {
                // Check if users exist
                const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [otherUserId]);
                if (userCheck.rows.length === 0) {
                    return res.status(404).json({ error: 'User not found' });
                }
            }
            
            // Get messages
            const query = `
                SELECT 
                    m.*,
                    u_sender.name as sender_name,
                    u_sender.email as sender_email,
                    u_sender.role as sender_role,
                    u_receiver.name as receiver_name,
                    u_receiver.email as receiver_email,
                    u_receiver.role as receiver_role
                FROM messages m
                JOIN users u_sender ON u_sender.id = m.sender_id
                JOIN users u_receiver ON u_receiver.id = m.receiver_id
                WHERE (m.sender_id = $1 AND m.receiver_id = $2) 
                   OR (m.sender_id = $2 AND m.receiver_id = $1)
                ORDER BY m.created_at DESC
                LIMIT $3 OFFSET $4
            `;
            
            const result = await pool.query(query, [userId, otherUserId, limit, offset]);
            
            // Mark messages as read
            await this.markMessagesAsRead(userId, otherUserId);
            
            res.json(result.rows.reverse());
        } catch (error) {
            console.error('Error getting messages:', error);
            res.status(500).json({ error: 'Failed to get messages' });
        }
    }

    // Mark messages as read
    async markMessagesAsRead(userId, otherUserId) {
        try {
            const query = `
                UPDATE messages 
                SET is_read = TRUE 
                WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE
                RETURNING *
            `;
            
            const result = await pool.query(query, [userId, otherUserId]);
            
            // Update unread count in conversations
            const user1 = Math.min(userId, otherUserId);
            const user2 = Math.max(userId, otherUserId);
            
            const updateUnreadQuery = `
                UPDATE conversations 
                SET 
                    user1_unread_count = CASE 
                        WHEN user1_id = $1 THEN 0 
                        ELSE user1_unread_count 
                    END,
                    user2_unread_count = CASE 
                        WHEN user2_id = $1 THEN 0 
                        ELSE user2_unread_count 
                    END
                WHERE (user1_id = $1 AND user2_id = $2) 
                   OR (user1_id = $2 AND user2_id = $1)
            `;
            
            await pool.query(updateUnreadQuery, [userId, otherUserId]);
            
            return result.rows;
        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    }

    // Upload file
    async uploadFile(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            
            const fileUrl = `/uploads/chats/${req.file.filename}`;
            
            res.json({
                url: fileUrl,
                name: req.file.originalname,
                type: req.file.mimetype,
                size: req.file.size
            });
        } catch (error) {
            console.error('Error uploading file:', error);
            res.status(500).json({ error: 'Failed to upload file' });
        }
    }
}

module.exports = new ChatController();