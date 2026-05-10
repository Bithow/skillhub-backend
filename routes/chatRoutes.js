const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const {
    sendMessage,
    getConversation,
    getConversations,
    getUnreadCount,
    adminGetAllConversations,
    adminGetConversation,
    deleteMessage
} = require('../controllers/chatController');

// All chat routes require authentication
router.use(protect);

// User routes
router.post('/send', sendMessage);
router.get('/conversations', getConversations);
router.get('/unread', getUnreadCount);
router.get('/conversation/:userId', getConversation);
router.delete('/message/:id', deleteMessage);

// Admin-only routes
router.get('/admin/all', roleCheck('admin'), adminGetAllConversations);
router.get('/admin/conversation/:conversationId', roleCheck('admin'), adminGetConversation);

module.exports = router;
