const express = require('express');
const router = express.Router();

// Simple routes for testing
router.get('/test', (req, res) => {
    res.json({ message: 'Payment routes working' });
});

router.post('/create-payment-intent', (req, res) => {
    res.json({ message: 'Create payment intent endpoint - to be implemented' });
});

router.get('/status/:paymentId', (req, res) => {
    res.json({ message: `Payment status for ${req.params.paymentId} - to be implemented` });
});

module.exports = router;