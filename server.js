require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 5000;

// Import routes
const paymentRoutes = require('./src/routes/payment.routes');
const appointmentRoutes = require('./src/routes/appointments.routes');

// Use routes BEFORE listening
app.use('/api/payments', paymentRoutes);
app.use('/api/appointments', appointmentRoutes);

// Start server
const server = app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ API base: http://localhost:${PORT}/api`);
  console.log(`✅ Time: ${new Date().toLocaleString()}`);
});

// Handle errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use!`);
    console.log('Try:');
    console.log('1. Change PORT in .env file to 5001');
    console.log('2. Or kill the process using port 5000');
  } else {
    console.error('Server error:', error);
  }
});