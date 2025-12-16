require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const paymentRoutes = require('./src/routes/payment.routes');
app.use('/api/payments', paymentRoutes);

const appointmentRoutes = require('./src/routes/appointments.routes');
app.use('/api/appointments', appointmentRoutes);
