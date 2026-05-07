const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { isAdmin } = require('../middleware/roleCheck');
const {
    handleWebhook,
    sendBroadcast,
    getMessages
} = require('../controllers/whatsappController');

// Webhook (public - Facebook/Meta verification)
router.post('/webhook', handleWebhook);
router.get('/webhook', handleWebhook);

// Admin only routes
router.post('/broadcast', protect, isAdmin, sendBroadcast);
router.get('/messages', protect, isAdmin, getMessages);

module.exports = router;