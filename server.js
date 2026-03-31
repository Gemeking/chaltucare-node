require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors());
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

// ============================================
// REGISTER ROUTES
// ============================================
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);

// ============================================
// PUBLIC ENDPOINTS
// ============================================

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        name: 'ChaltuCare API',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            auth: '/api/auth',
            chat: '/api/chat',
            users: '/api/users',
            admin: '/api/admin'
        }
    });
});

// Get all users
app.get('/api/users', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        const result = await pool.query(`
            SELECT id, name, email, role, is_verified, created_at 
            FROM users 
            ORDER BY id
        `);
        res.json({
            success: true,
            count: result.rows.length,
            users: result.rows
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get user by ID
app.get('/api/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const pool = require('./src/config/db');
        const result = await pool.query(`
            SELECT id, name, email, role, is_verified, created_at 
            FROM users 
            WHERE id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Admin endpoint to list all users
app.get('/api/admin/users', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        const result = await pool.query('SELECT * FROM users ORDER BY id');
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

// Database test
app.get('/api/db-test', async (req, res) => {
    try {
        const pool = require('./src/config/db');
        const result = await pool.query('SELECT NOW() as current_time');
        res.json({
            success: true,
            message: 'Database connected successfully',
            time: result.rows[0].current_time,
            database: process.env.DB_NAME
        });
    } catch (error) {
        console.error('DB Error:', error);
        res.status(500).json({ 
            success: false,
            error: error.message 
        });
    }
});

// Debug routes endpoint
app.get('/api/debug/routes', (req, res) => {
    const routes = [];
    
    function extractRoutes(stack, basePath = '') {
        if (!stack) return;
        
        stack.forEach(layer => {
            if (layer.route) {
                const methods = Object.keys(layer.route.methods).join(', ').toUpperCase();
                routes.push({
                    path: basePath + layer.route.path,
                    methods: methods
                });
            } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
                let routerPath = basePath;
                if (layer.regexp) {
                    const pathStr = layer.regexp.source
                        .replace('\\/?(?=\\/|$)', '')
                        .replace(/\\\//g, '/')
                        .replace(/^\^/, '')
                        .replace(/\?$/, '');
                    routerPath = basePath + pathStr;
                }
                extractRoutes(layer.handle.stack, routerPath);
            }
        });
    }
    
    if (app._router && app._router.stack) {
        extractRoutes(app._router.stack);
    }
    
    res.json({
        success: true,
        total: routes.length,
        routes: routes.sort((a, b) => a.path.localeCompare(b.path))
    });
});

// ============================================
// ERROR HANDLING MIDDLEWARE
// ============================================

// 404 handler
app.use((req, res) => {
    res.status(404).json({ 
        error: 'Route not found',
        path: req.path,
        method: req.method
    });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: err.message 
    });
});

// ============================================
// START SERVER
// ============================================

const server = app.listen(PORT, () => {
    console.log('\n=================================');
    console.log(`✅ ChaltuCare Server Running`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log('=================================');
    console.log('\n📋 Available Endpoints:');
    console.log(`   🏠 Home:         GET  http://localhost:${PORT}/`);
    console.log(`   ❤️  Health:       GET  http://localhost:${PORT}/health`);
    console.log(`   🗄️  DB Test:      GET  http://localhost:${PORT}/api/db-test`);
    console.log(`   👥 Users:        GET  http://localhost:${PORT}/api/users`);
    console.log(`   🔐 Auth:         POST http://localhost:${PORT}/api/auth/login`);
    console.log(`   📝 Register:     POST http://localhost:${PORT}/api/auth/register`);
    console.log(`   💬 Chat Test:    GET  http://localhost:${PORT}/api/chat/test`);
    console.log(`   💬 Send Message: POST http://localhost:${PORT}/api/chat/messages`);
    console.log(`   🔍 Debug Routes: GET  http://localhost:${PORT}/api/debug/routes`);
    console.log('=================================\n');
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} is already in use!`);
        console.log('   Solutions:');
        console.log(`   1. Change PORT in .env file to 5001`);
        console.log(`   2. Kill process using port ${PORT}:`);
        console.log(`      - Windows: netstat -ano | findstr :${PORT}`);
        console.log(`      - Mac/Linux: lsof -i :${PORT}`);
    } else {
        console.error('Server error:', error);
    }
});

module.exports = server;