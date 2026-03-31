const express = require('express');
const router = express.Router();

// Remove the router.use line if authMiddleware is not properly defined
// For now, just add a simple test route
router.get('/test', (req, res) => {
    res.json({ message: 'Protected route working' });
});

// If you want to add auth middleware later, make sure it's properly imported
// const authMiddleware = require('../middleware/auth.middleware');
// router.use(authMiddleware);

module.exports = router;