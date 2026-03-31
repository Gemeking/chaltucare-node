const express = require('express');
const router = express.Router();

// Simple routes for testing
router.get('/test', (req, res) => {
    res.json({ message: 'Appointment routes working' });
});

router.get('/', (req, res) => {
    res.json({ message: 'Get all appointments - to be implemented' });
});

router.post('/', (req, res) => {
    res.json({ message: 'Create appointment - to be implemented' });
});

router.get('/:id', (req, res) => {
    res.json({ message: `Get appointment ${req.params.id} - to be implemented` });
});

router.put('/:id', (req, res) => {
    res.json({ message: `Update appointment ${req.params.id} - to be implemented` });
});

router.delete('/:id', (req, res) => {
    res.json({ message: `Delete appointment ${req.params.id} - to be implemented` });
});

module.exports = router;