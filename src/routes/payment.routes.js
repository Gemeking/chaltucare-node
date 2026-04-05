const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../config/upload.config');

// Apply auth middleware to all payment routes
router.use(authMiddleware);

// Payment routes
router.post('/create-payment-intent', paymentController.createPaymentIntent.bind(paymentController));
router.post('/submit', paymentController.submitPayment.bind(paymentController));
router.post('/verify', paymentController.verifyPayment.bind(paymentController));
router.get('/status/:paymentId', paymentController.getPaymentStatus.bind(paymentController));
router.get('/history', paymentController.getUserPayments.bind(paymentController));

// Payment screenshot upload route
router.post('/upload-screenshot', upload.single('file'), paymentController.uploadPaymentScreenshot.bind(paymentController));

// Test route to check if routes are working
router.get('/test', (req, res) => {
  res.json({ message: 'Payment routes are working' });
});

module.exports = router;