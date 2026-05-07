const express = require('express');
const router = express.Router();
const { protect, isAdmin } = require('../middleware/roleCheck');
const {
    handleWebhook,
    sendBroadcast,
    getMessages
} = require('../controllers/whatsappController');

// Webhook (public - Facebook/Meta verification)
router.post('/webhook', handleWebhook);
router.get('/webhook', handleWebhook);

// Admin only routes
router.use(protect, isAdmin);
router.post('/broadcast', sendBroadcast);
router.get('/messages', getMessages);

module.exports = router;