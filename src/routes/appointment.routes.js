const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Apply auth middleware to all appointment routes
router.use(authMiddleware);

// Plan routes
router.get('/plans', appointmentController.getPlans);

// Appointment routes
router.post('/', appointmentController.createAppointment);
router.get('/my', appointmentController.getUserAppointments);
router.get('/doctor', appointmentController.getDoctorAppointments);
router.get('/:id', appointmentController.getAppointmentById);
router.patch('/:id/status', appointmentController.updateAppointmentStatus);
router.get('/slots/:doctorId/:date', appointmentController.getAvailableSlots);

// Appointment messages
router.post('/messages', appointmentController.addAppointmentMessage);
router.get('/:appointmentId/messages', appointmentController.getAppointmentMessages);

module.exports = router;