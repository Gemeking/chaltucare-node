const pool = require('../config/db');

class ChatController {
    constructor() {
        // Bind all methods to ensure 'this' works correctly
        this.sendMessage = this.sendMessage.bind(this);
        this.uploadFile = this.uploadFile.bind(this);
        this.getConversations = this.getConversations.bind(this);
        this.getMessages = this.getMessages.bind(this);
        this.markMessagesAsRead = this.markMessagesAsRead.bind(this);
    }

    // Send a message (with optional file)
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
                
                // Check if conversation exists
                const checkConv = await client.query(
                    'SELECT id FROM conversations WHERE user1_id = $1 AND user2_id = $2',
                    [user1, user2]
                );
                
                if (checkConv.rows.length > 0) {
                    // Update existing conversation
                    await client.query(
                        `UPDATE conversations 
                         SET last_message = $1,
                             last_message_time = CURRENT_TIMESTAMP,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE user1_id = $2 AND user2_id = $3`,
                        [message || '📎 File attached', user1, user2]
                    );
                } else {
                    // Create new conversation
                    await client.query(
                        `INSERT INTO conversations (user1_id, user2_id, last_message, last_message_time)
                         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
                        [user1, user2, message || '📎 File attached']
                    );
                }

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

    // Upload file
    async uploadFile(req, res) {
        try {
            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }
            
            // Determine file type category
            let fileCategory = 'chats';
            if (req.file.mimetype.startsWith('image/')) {
                fileCategory = 'images';
            } else if (req.file.mimetype.startsWith('video/')) {
                fileCategory = 'videos';
            } else if (req.file.mimetype === 'application/pdf' || 
                       req.file.mimetype.includes('document') ||
                       req.file.mimetype === 'application/msword' ||
                       req.file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
                fileCategory = 'documents';
            }
            
            const fileUrl = `/uploads/${fileCategory}/${req.file.filename}`;
            
            res.json({
                success: true,
                file: {
                    url: fileUrl,
                    name: req.file.originalname,
                    type: req.file.mimetype,
                    size: req.file.size,
                    filename: req.file.filename,
                    category: fileCategory
                }
            });
        } catch (error) {
            console.error('Error uploading file:', error);
            res.status(500).json({ error: 'Failed to upload file' });
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
                ORDER BY m.created_at ASC
            `;
            
            const result = await pool.query(query, [userId, otherUserId]);
            
            // Mark messages as read - call the method properly
            await this.markMessagesAsRead(userId, otherUserId);
            
            res.json(result.rows);
        } catch (error) {
            console.error('Error getting messages:', error);
            res.status(500).json({ error: 'Failed to get messages' });
        }
    }

    // Mark messages as read
    async markMessagesAsRead(userId, otherUserId) {
        try {
            console.log(`Marking messages as read for user ${userId} from ${otherUserId}`);
            
            // Mark messages as read
            const result = await pool.query(
                `UPDATE messages 
                 SET is_read = TRUE 
                 WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE
                 RETURNING *`,
                [userId, otherUserId]
            );
            
            console.log(`Marked ${result.rows.length} messages as read`);
            
            // Update unread count in conversations
            const user1 = Math.min(userId, otherUserId);
            const user2 = Math.max(userId, otherUserId);
            
            // Reset unread count for the current user
            if (userId === user1) {
                await pool.query(
                    'UPDATE conversations SET user1_unread_count = 0 WHERE user1_id = $1 AND user2_id = $2',
                    [user1, user2]
                );
            } else {
                await pool.query(
                    'UPDATE conversations SET user2_unread_count = 0 WHERE user1_id = $1 AND user2_id = $2',
                    [user1, user2]
                );
            }
            
            return result.rows;
        } catch (error) {
            console.error('Error marking messages as read:', error);
            return [];
        }
    }
}

module.exports = new ChatController();