const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth.routes');
const protectedRoutes = require('./routes/protected.routes');

const app = express();

// ======================
// CORS CONFIGURATION
// ======================
// TEMPORARY FIX - Allow all origins
app.use(cors({
  origin: '*', // Allow ALL origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: false
}));
// ======================
// MIDDLEWARE
// ======================
app.use(express.json());

// Debug: log every request
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.body && Object.keys(req.body).length > 0) {
    console.log('Request Body:', req.body);
  }
  next();
});

// ======================
// ROUTES
// ======================
app.use('/api/auth', authRoutes);
app.use('/api/protected', protectedRoutes);

// ======================
// HEALTH CHECK ENDPOINT
// ======================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// ======================
// 404 HANDLER - FIXED!
// ======================
// This must come AFTER all other routes
app.use((req, res, next) => {
  console.log(`404: Route not found - ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// ======================
// ERROR HANDLER
// ======================
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

module.exports = app;