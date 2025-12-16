const express = require('express');
const authRoutes = require('./routes/auth.routes');

const app = express();

// Parse JSON requests
app.use(express.json());

// Debug: log every request
app.use((req, res, next) => {
  console.log(`Request: ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);

module.exports = app;


const protectedRoutes = require('./routes/protected.routes');

app.use('/api/protected', protectedRoutes);
