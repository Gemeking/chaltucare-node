require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
// Allow the deployed frontend URL + localhost in development
const allowedOrigins = [
    'http://localhost:3000',
    process.env.FRONTEND_URL,
].filter(Boolean);

const io = socketIo(server, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    }
});

const PORT = process.env.PORT || 5000;

// Helper function to get local IP
function getLocalIp() {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============================================
// STATIC FILES
// ============================================
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============================================
// IMPORT ROUTES
// ============================================
const authRoutes = require('./src/routes/auth.routes');
const chatRoutes = require('./src/routes/chat.routes');
const appointmentRoutes = require('./src/routes/appointment.routes');
const paymentRoutes = require('./src/routes/payment.routes');
const userRoutes = require('./src/routes/user.routes');
const notificationRoutes = require('./src/routes/notification.routes');

// ============================================
// REGISTER ROUTES
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);

// ============================================
// SOCKET.IO CONNECTION HANDLING
// ============================================
const connectedUsers = new Map();

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('Authentication error'));
    }
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        socket.userId = decoded.id;
        socket.userRole = decoded.role;
        next();
    } catch (err) {
        next(new Error('Invalid token'));
    }
});

// Notification helper function (defined once)
const sendNotification = async (userId, type, title, message, data = null) => {
    try {
        const pool = require('./src/config/db');
        
        const result = await pool.query(
            `INSERT INTO notifications (user_id, type, title, message, data, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING *`,
            [userId, type, title, message, data ? JSON.stringify(data) : null]
        );
        
        const notification = result.rows[0];
        
        const userSocketId = connectedUsers.get(parseInt(userId));
        if (userSocketId) {
            io.to(userSocketId).emit('new-notification', notification);
            console.log(`📢 Notification sent to user ${userId}: ${title}`);
        }
        
        return notification;
    } catch (error) {
        console.error('Error sending notification:', error);
        return null;
    }
};

global.sendNotification = sendNotification;

io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.userId} (${socket.userRole})`);
    
    connectedUsers.set(socket.userId, socket.id);
    io.emit('user-status', { userId: socket.userId, isOnline: true });
    socket.join(`user:${socket.userId}`);
    
    // Chat events
    socket.on('join-conversation', (otherUserId) => {
        const room = getConversationRoom(socket.userId, otherUserId);
        socket.join(room);
    });
    
    socket.on('leave-conversation', (otherUserId) => {
        const room = getConversationRoom(socket.userId, otherUserId);
        socket.leave(room);
    });
    
    socket.on('send-message', async (data) => {
        try {
            const { receiverId, message, file } = data;
            const senderId = socket.userId;
            
            console.log(`📤 Sending message from ${senderId} to ${receiverId}: ${message || '📎 File'}`);
            
            const pool = require('./src/config/db');
            
            const insertQuery = `
                INSERT INTO messages (sender_id, receiver_id, message, file_url, file_name, file_type, file_size)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING *
            `;
            
            const values = [senderId, receiverId, message || null, file?.url || null, file?.name || null, file?.type || null, file?.size || null];
            const result = await pool.query(insertQuery, values);
            const newMessage = result.rows[0];
            
            const userQuery = 'SELECT id, name, email, role FROM users WHERE id = $1';
            const senderResult = await pool.query(userQuery, [senderId]);
            
            const messageData = { ...newMessage, sender: senderResult.rows[0], timestamp: new Date() };
            
            const user1 = Math.min(senderId, receiverId);
            const user2 = Math.max(senderId, receiverId);
            
            const checkConv = await pool.query('SELECT id FROM conversations WHERE user1_id = $1 AND user2_id = $2', [user1, user2]);
            
            if (checkConv.rows.length > 0) {
                await pool.query(`UPDATE conversations SET last_message = $1, last_message_time = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE user1_id = $2 AND user2_id = $3`, [message || '📎 File attached', user1, user2]);
            } else {
                await pool.query(`INSERT INTO conversations (user1_id, user2_id, last_message, last_message_time) VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, [user1, user2, message || '📎 File attached']);
            }
            
            const receiverSocketId = connectedUsers.get(parseInt(receiverId));
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('new-message', messageData);
                console.log(`✅ Message sent to user ${receiverId}`);
                
                // Send notification for new message
                await sendNotification(
                    parseInt(receiverId),
                    'new_message',
                    'New Message',
                    `${senderResult.rows[0].name} sent you a message: ${message?.substring(0, 50) || '📎 File'}`,
                    { 
                        message_id: newMessage.id, 
                        sender_id: senderId, 
                        sender_name: senderResult.rows[0].name,
                        chat_room: `conversation:${user1}:${user2}`
                    }
                );
            }
            
            io.to(socket.id).emit('message-sent', messageData);
            
            const room = getConversationRoom(senderId, receiverId);
            io.to(room).emit('conversation-message', messageData);
            
        } catch (error) {
            console.error('❌ Error sending message:', error);
            socket.emit('message-error', { error: 'Failed to send message' });
        }
    });
    
    socket.on('typing', (data) => {
        const receiverSocketId = connectedUsers.get(data.receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('user-typing', { userId: socket.userId, isTyping: data.isTyping });
        }
    });
    
    socket.on('mark-read', async (data) => {
        try {
            const pool = require('./src/config/db');
            await pool.query(`UPDATE messages SET is_read = TRUE WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE`, [socket.userId, data.otherUserId]);
            const senderSocketId = connectedUsers.get(data.otherUserId);
            if (senderSocketId) {
                io.to(senderSocketId).emit('messages-read', { userId: socket.userId, otherUserId: data.otherUserId });
            }
        } catch (error) {
            console.error('Error marking messages as read:', error);
        }
    });
    
    // Video call events
    socket.on('call-user', async (data) => {
        try {
            const { receiverId, callType = 'video', callerName, signal } = data;
            const callerId = socket.userId;
            
            const pool = require('./src/config/db');
            const callResult = await pool.query(`INSERT INTO video_calls (caller_id, receiver_id, status, call_type, started_at) VALUES ($1, $2, 'pending', $3, CURRENT_TIMESTAMP) RETURNING *`, [callerId, receiverId, callType]);
            const call = callResult.rows[0];
            
            await pool.query(`INSERT INTO call_invitations (call_id, inviter_id, invitee_id, status) VALUES ($1, $2, $3, 'pending')`, [call.id, callerId, receiverId]);
            
            const receiverSocketId = connectedUsers.get(parseInt(receiverId));
            if (receiverSocketId) {
                io.to(receiverSocketId).emit('incoming-call', { callId: call.id, callerId: callerId, callerName: callerName || 'User', callType: callType, signal: signal });
            } else {
                await pool.query(`UPDATE video_calls SET status = 'missed' WHERE id = $1`, [call.id]);
                socket.emit('call-error', { error: 'User is offline' });
            }
        } catch (error) {
            console.error('Error initiating call:', error);
            socket.emit('call-error', { error: 'Failed to initiate call' });
        }
    });
    
    socket.on('accept-call', async (data) => {
        try {
            const { callId, signal } = data;
            const receiverId = socket.userId;
            const pool = require('./src/config/db');
            
            await pool.query(`UPDATE video_calls SET status = 'active', started_at = CURRENT_TIMESTAMP WHERE id = $1`, [callId]);
            await pool.query(`UPDATE call_invitations SET status = 'accepted' WHERE call_id = $1 AND invitee_id = $2`, [callId, receiverId]);
            
            const callResult = await pool.query(`SELECT caller_id FROM video_calls WHERE id = $1`, [callId]);
            if (callResult.rows.length > 0) {
                const callerId = callResult.rows[0].caller_id;
                const callerSocketId = connectedUsers.get(callerId);
                if (callerSocketId) {
                    io.to(callerSocketId).emit('call-accepted', { callId: callId, signal: signal });
                }
            }
        } catch (error) {
            console.error('Error accepting call:', error);
            socket.emit('call-error', { error: 'Failed to accept call' });
        }
    });
    
    socket.on('reject-call', async (data) => {
        try {
            const { callId } = data;
            const receiverId = socket.userId;
            const pool = require('./src/config/db');
            
            await pool.query(`UPDATE video_calls SET status = 'rejected' WHERE id = $1`, [callId]);
            await pool.query(`UPDATE call_invitations SET status = 'rejected' WHERE call_id = $1 AND invitee_id = $2`, [callId, receiverId]);
            
            const callResult = await pool.query(`SELECT caller_id FROM video_calls WHERE id = $1`, [callId]);
            if (callResult.rows.length > 0) {
                const callerId = callResult.rows[0].caller_id;
                const callerSocketId = connectedUsers.get(callerId);
                if (callerSocketId) {
                    io.to(callerSocketId).emit('call-rejected', { callId: callId });
                }
            }
        } catch (error) {
            console.error('Error rejecting call:', error);
            socket.emit('call-error', { error: 'Failed to reject call' });
        }
    });
    
    socket.on('end-call', async (data) => {
        try {
            const { callId } = data;
            const userId = socket.userId;
            const pool = require('./src/config/db');
            
            const callResult = await pool.query(`SELECT started_at FROM video_calls WHERE id = $1`, [callId]);
            let duration = 0;
            if (callResult.rows.length > 0 && callResult.rows[0].started_at) {
                const startTime = new Date(callResult.rows[0].started_at);
                const endTime = new Date();
                duration = Math.floor((endTime - startTime) / 1000);
            }
            
            await pool.query(`UPDATE video_calls SET status = 'ended', ended_at = CURRENT_TIMESTAMP, duration = $2 WHERE id = $1`, [callId, duration]);
            
            const callDetails = await pool.query(`SELECT caller_id, receiver_id FROM video_calls WHERE id = $1`, [callId]);
            if (callDetails.rows.length > 0) {
                const otherUserId = callDetails.rows[0].caller_id === userId ? callDetails.rows[0].receiver_id : callDetails.rows[0].caller_id;
                const otherSocketId = connectedUsers.get(otherUserId);
                if (otherSocketId) {
                    io.to(otherSocketId).emit('call-ended', { callId: callId });
                }
            }
        } catch (error) {
            console.error('Error ending call:', error);
            socket.emit('call-error', { error: 'Failed to end call' });
        }
    });
    
    socket.on('send-signal', (data) => {
        const receiverSocketId = connectedUsers.get(parseInt(data.to));
        if (receiverSocketId) {
            io.to(receiverSocketId).emit('receive-signal', { from: socket.userId, signal: data.signal });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`❌ User disconnected: ${socket.userId}`);
        connectedUsers.delete(socket.userId);
        io.emit('user-status', { userId: socket.userId, isOnline: false });
    });
});

function getConversationRoom(userId1, userId2) {
    const [smallId, largeId] = [Math.min(userId1, userId2), Math.max(userId1, userId2)];
    return `conversation:${smallId}:${largeId}`;
}

app.set('io', io);
app.set('connectedUsers', connectedUsers);

// ============================================
// PUBLIC ENDPOINTS
// ============================================

app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/', (req, res) => {
    res.json({ name: 'ChaltuCare API', version: '1.0.0', endpoints: { health: '/health', auth: '/api/auth', chat: '/api/chat', users: '/api/users', appointments: '/api/appointments', payments: '/api/payments' } });
});

app.get('/api/db-test', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        const result = await pool.query('SELECT NOW() as current_time');
        res.json({ success: true, message: 'Database connected successfully', time: result.rows[0].current_time });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/test-plans', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        const result = await pool.query('SELECT * FROM plans');
        res.json({ success: true, plans: result.rows });
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
});

app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});

// ============================================
// START SERVER
// ============================================

server.listen(PORT, '0.0.0.0', () => {
    console.log('\n=================================');
    console.log(`✅ ChaltuCare Server Running`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 Local: http://localhost:${PORT}`);
    console.log(`🌐 Network: http://${getLocalIp()}:${PORT}`);
    console.log(`🔌 Socket.IO: ws://localhost:${PORT}`);
    console.log('=================================');
    console.log('\n📋 Available Endpoints:');
    console.log(`   👥 Users:        GET  http://localhost:${PORT}/api/users`);
    console.log(`   🔐 Auth:         POST http://localhost:${PORT}/api/auth/login`);
    console.log(`   💬 Chat:         POST http://localhost:${PORT}/api/chat/messages`);
    console.log(`   📅 Plans:        GET  http://localhost:${PORT}/api/appointments/plans`);
    console.log(`   📞 Video Call:    Socket.IO events`);
    console.log('=================================\n');
});

module.exports = { server, io, connectedUsers };