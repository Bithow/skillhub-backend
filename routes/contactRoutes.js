const express = require('express');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { createContactMessage, getContactMessages } = require('../controllers/contactController');

const router = express.Router();
const contactSubmissionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false
});

router.post('/', contactSubmissionLimiter, createContactMessage);
router.get('/messages', protect, roleCheck('admin'), getContactMessages);

module.exports = router;
