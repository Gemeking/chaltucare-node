require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Basic middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple test routes
app.get('/', (req, res) => {
    res.json({ message: 'Server is running!' });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Database test
app.get('/api/db-test', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        const result = await pool.query('SELECT NOW() as current_time');
        res.json({ 
            success: true,
            message: 'Database connected successfully',
            time: result.rows[0].current_time
        });
    } catch (error) {
        console.error('DB Error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// User routes
app.get('/api/users', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        const result = await pool.query('SELECT id, name, email, role FROM users LIMIT 10');
        res.json({
            success: true,
            count: result.rows.length,
            users: result.rows
        });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin users
app.get('/api/admin/users', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        const result = await pool.query('SELECT id, name, email, role, is_verified FROM users');
        res.json(result.rows);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Chat test routes
app.get('/api/chat/test', (req, res) => {
    res.json({ message: 'Chat routes are working!' });
});

app.post('/api/chat/messages', (req, res) => {
    res.json({ 
        message: 'Message endpoint working',
        received: req.body 
    });
});

app.get('/api/chat/conversations', (req, res) => {
    res.json({ conversations: [] });
});

// Debug all routes
app.get('/api/debug/routes', (req, res) => {
    const routes = [];
    
    function extractRoutes(stack, basePath = '') {
        if (!stack) return;
        
        stack.forEach(layer => {
            if (layer.route) {
                const methods = Object.keys(layer.route.methods).join(', ');
                routes.push({
                    path: basePath + layer.route.path,
                    methods: methods.toUpperCase()
                });
            }
        });
    }
    
    if (app._router && app._router.stack) {
        extractRoutes(app._router.stack);
    }
    
    res.json({
        total: routes.length,
        routes: routes.sort((a, b) => a.path.localeCompare(b.path))
    });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`\n✅ Server running on port ${PORT}`);
    console.log(`📋 Available endpoints:`);
    console.log(`   - GET  http://localhost:${PORT}/health`);
    console.log(`   - GET  http://localhost:${PORT}/api/db-test`);
    console.log(`   - GET  http://localhost:${PORT}/api/users`);
    console.log(`   - GET  http://localhost:${PORT}/api/admin/users`);
    console.log(`   - GET  http://localhost:${PORT}/api/chat/test`);
    console.log(`   - POST http://localhost:${PORT}/api/chat/messages`);
    console.log(`   - GET  http://localhost:${PORT}/api/debug/routes\n`);
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use!`);
    } else {
        console.error('Server error:', error);
    }
});