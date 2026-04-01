const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../config/upload.config');

// Apply auth middleware to all payment routes
router.use(authMiddleware);

// Payment routes
router.post('/create-payment-intent', paymentController.createPaymentIntent.bind(paymentController));
router.post('/confirm', paymentController.confirmPayment.bind(paymentController));
router.get('/status/:paymentId', paymentController.getPaymentStatus.bind(paymentController));
router.get('/history', paymentController.getUserPayments.bind(paymentController));

// Payment screenshot upload route - make sure the endpoint matches
router.post('/upload-screenshot', upload.single('file'), (req, res, next) => {
    console.log('Payment upload endpoint hit');
    next();
}, paymentController.uploadPaymentScreenshot.bind(paymentController));

module.exports = router;