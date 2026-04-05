const express = require('express');
const router = express.Router();
const appointmentController = require('../controllers/appointment.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Middleware to check if user is admin
const checkAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Apply auth middleware to all appointment routes
router.use(authMiddleware);

// Public routes (for all authenticated users)
router.get('/plans', appointmentController.getPlans.bind(appointmentController));
router.post('/', appointmentController.createAppointment.bind(appointmentController));
router.get('/my', appointmentController.getUserAppointments.bind(appointmentController));
router.get('/doctor', appointmentController.getDoctorAppointments.bind(appointmentController));
router.get('/:id', appointmentController.getAppointmentById.bind(appointmentController));
router.patch('/:id/status', appointmentController.updateAppointmentStatus.bind(appointmentController));
router.get('/slots/:doctorId/:date', appointmentController.getAvailableSlots.bind(appointmentController));
router.post('/messages', appointmentController.addAppointmentMessage.bind(appointmentController));
router.get('/:appointmentId/messages', appointmentController.getAppointmentMessages.bind(appointmentController));

// Admin only routes - plan management
router.post('/plans', checkAdmin, appointmentController.createPlan.bind(appointmentController));
router.put('/plans/:id', checkAdmin, appointmentController.updatePlan.bind(appointmentController));
router.delete('/plans/:id', checkAdmin, appointmentController.deletePlan.bind(appointmentController));
router.patch('/plans/:id/toggle', checkAdmin, appointmentController.togglePlan.bind(appointmentController));



module.exports = router;