const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');

class SocketManager {
    constructor(server) {
        this.io = new Server(server, {
            cors: {
                origin: process.env.FRONTEND_URL || 'http://localhost:3000',
                methods: ['GET', 'POST'],
                credentials: true
            }
        });
        
        this.connectedUsers = new Map(); // userId -> socketId
        this.userSockets = new Map(); // socketId -> userId
        
        this.initialize();
    }
    
    initialize() {
        // Authentication middleware
        this.io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth.token;
                if (!token) {
                    return next(new Error('Authentication error'));
                }
                
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                socket.userId = decoded.id;
                socket.userRole = decoded.role;
                next();
            } catch (error) {
                next(new Error('Authentication error'));
            }
        });
        
        this.io.on('connection', (socket) => {
            console.log(`User connected: ${socket.userId} (${socket.userRole})`);
            
            // Store connection
            this.connectedUsers.set(socket.userId, socket.id);
            this.userSockets.set(socket.id, socket.userId);
            
            // Send online status to all connected users
            this.broadcastUserStatus(socket.userId, true);
            
            // Join user to their personal room
            socket.join(`user:${socket.userId}`);
            
            // Handle joining a conversation room
            socket.on('join-conversation', (otherUserId) => {
                const room = this.getConversationRoom(socket.userId, otherUserId);
                socket.join(room);
                console.log(`User ${socket.userId} joined room ${room}`);
            });
            
            // Handle leaving a conversation room
            socket.on('leave-conversation', (otherUserId) => {
                const room = this.getConversationRoom(socket.userId, otherUserId);
                socket.leave(room);
            });
            
            // Handle sending message
            socket.on('send-message', async (data) => {
                try {
                    const { receiverId, message, file } = data;
                    
                    // Save to database
                    const query = `
                        INSERT INTO messages (sender_id, receiver_id, message, file_url, file_name, file_type, file_size)
                        VALUES ($1, $2, $3, $4, $5, $6, $7)
                        RETURNING *
                    `;
                    
                    const values = [
                        socket.userId,
                        receiverId,
                        message || null,
                        file?.url || null,
                        file?.name || null,
                        file?.type || null,
                        file?.size || null
                    ];
                    
                    const result = await pool.query(query, values);
                    const newMessage = result.rows[0];
                    
                    // Get user details
                    const userQuery = 'SELECT id, name, email, role FROM users WHERE id = $1';
                    const senderResult = await pool.query(userQuery, [socket.userId]);
                    
                    const messageData = {
                        ...newMessage,
                        sender: senderResult.rows[0],
                        timestamp: new Date()
                    };
                    
                    // Update or create conversation
                    const user1 = Math.min(socket.userId, receiverId);
                    const user2 = Math.max(socket.userId, receiverId);
                    
                    const updateConversationQuery = `
                        INSERT INTO conversations (user1_id, user2_id, last_message, last_message_time)
                        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                        ON CONFLICT (user1_id, user2_id) 
                        DO UPDATE SET 
                            last_message = $3,
                            last_message_time = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP,
                            user1_unread_count = CASE 
                                WHEN $4 = user1_id THEN user1_unread_count + 1 
                                ELSE user1_unread_count 
                            END,
                            user2_unread_count = CASE 
                                WHEN $4 = user2_id THEN user2_unread_count + 1 
                                ELSE user2_unread_count 
                            END
                    `;
                    
                    await pool.query(updateConversationQuery, [user1, user2, message || '📎 File attached', receiverId]);
                    
                    // Send to receiver if online
                    const receiverSocketId = this.connectedUsers.get(receiverId);
                    if (receiverSocketId) {
                        this.io.to(receiverSocketId).emit('new-message', messageData);
                    }
                    
                    // Send to sender's room (for multiple tabs)
                    this.io.to(`user:${socket.userId}`).emit('message-sent', messageData);
                    
                    // Send to conversation room
                    const room = this.getConversationRoom(socket.userId, receiverId);
                    this.io.to(room).emit('conversation-message', messageData);
                    
                } catch (error) {
                    console.error('Error sending message:', error);
                    socket.emit('message-error', { error: 'Failed to send message' });
                }
            });
            
            // Handle typing indicator
            socket.on('typing', (data) => {
                const { receiverId, isTyping } = data;
                const receiverSocketId = this.connectedUsers.get(receiverId);
                
                if (receiverSocketId) {
                    this.io.to(receiverSocketId).emit('user-typing', {
                        userId: socket.userId,
                        isTyping
                    });
                }
            });
            
            // Handle marking messages as read
            socket.on('mark-read', async (data) => {
                const { otherUserId } = data;
                
                try {
                    const query = `
                        UPDATE messages 
                        SET is_read = TRUE 
                        WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE
                    `;
                    
                    await pool.query(query, [socket.userId, otherUserId]);
                    
                    // Update unread count in conversation
                    const user1 = Math.min(socket.userId, otherUserId);
                    const user2 = Math.max(socket.userId, otherUserId);
                    
                    const updateQuery = `
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
                    
                    await pool.query(updateQuery, [socket.userId, otherUserId]);
                    
                    // Notify sender that messages were read
                    const senderSocketId = this.connectedUsers.get(otherUserId);
                    if (senderSocketId) {
                        this.io.to(senderSocketId).emit('messages-read', {
                            userId: socket.userId,
                            otherUserId
                        });
                    }
                } catch (error) {
                    console.error('Error marking messages as read:', error);
                }
            });
            
            // ── WebRTC Signaling ──────────────────────────────────

            // Caller initiates a call
            socket.on('call-user', (data) => {
                const { receiverId, callType, callerName, signal } = data;
                const receiverSocket = this.connectedUsers.get(parseInt(receiverId));
                if (receiverSocket) {
                    const callId = `call-${socket.userId}-${receiverId}-${Date.now()}`;
                    this.io.to(receiverSocket).emit('incoming-call', {
                        callId,
                        callerId:   socket.userId,
                        callerName: callerName || 'Unknown',
                        callType:   callType || 'video',
                        signal,
                    });
                    console.log(`Call from ${socket.userId} to ${receiverId}`);
                }
            });

            // Relay SDP answer or ICE candidate to the target peer
            socket.on('send-signal', (data) => {
                const { to, signal } = data;
                const targetSocket = this.connectedUsers.get(parseInt(to));
                if (targetSocket) {
                    this.io.to(targetSocket).emit('receive-signal', {
                        from: socket.userId,
                        signal,
                    });
                }
            });

            // Receiver accepted the call — notify caller
            socket.on('accept-call', (data) => {
                const { callId } = data;
                // callId format: call-{callerId}-{receiverId}-{ts}
                const parts = String(callId).split('-');
                const callerId = parseInt(parts[1]);
                const callerSocket = this.connectedUsers.get(callerId);
                if (callerSocket) {
                    this.io.to(callerSocket).emit('call-accepted', { callId });
                }
            });

            // Receiver rejected the call — notify caller
            socket.on('reject-call', (data) => {
                const { callId } = data;
                const parts = String(callId).split('-');
                const callerId = parseInt(parts[1]);
                const callerSocket = this.connectedUsers.get(callerId);
                if (callerSocket) {
                    this.io.to(callerSocket).emit('call-rejected', { callId });
                }
            });

            // Either party ended the call — notify the other
            socket.on('end-call', (data) => {
                const { callId, to } = data;
                let otherId = to ? parseInt(to) : null;
                if (!otherId && callId) {
                    const parts = String(callId).split('-');
                    const callerId   = parseInt(parts[1]);
                    const receiverId = parseInt(parts[2]);
                    otherId = socket.userId === callerId ? receiverId : callerId;
                }
                if (otherId) {
                    const otherSocket = this.connectedUsers.get(otherId);
                    if (otherSocket) this.io.to(otherSocket).emit('call-ended', { callId });
                }
            });

            // Handle disconnect
            socket.on('disconnect', () => {
                console.log(`User disconnected: ${socket.userId}`);
                this.connectedUsers.delete(socket.userId);
                this.userSockets.delete(socket.id);
                this.broadcastUserStatus(socket.userId, false);
            });
        });
    }
    
    getConversationRoom(userId1, userId2) {
        const [smallId, largeId] = [Math.min(userId1, userId2), Math.max(userId1, userId2)];
        return `conversation:${smallId}:${largeId}`;
    }
    
    broadcastUserStatus(userId, isOnline) {
        this.io.emit('user-status', {
            userId,
            isOnline,
            timestamp: new Date()
        });
    }
    
    getIO() {
        return this.io;
    }
}

module.exports = SocketManager;