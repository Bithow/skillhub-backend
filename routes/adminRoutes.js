const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const {
    getStats,
    getPendingApprovals,
    approveUser,
    rejectUser,
    approveCourse,
    rejectCourse,
    getAllUsers,
    getAllTransactions,
    updateTransactionStatus,
    sendBroadcast
} = require('../controllers/adminController');
const {
    adminGetAllConversations,
    adminGetConversation
} = require('../controllers/chatController');

// All admin routes require authentication + admin role
router.use(protect);
router.use(roleCheck('admin'));

router.get('/stats', getStats);
router.get('/pending', getPendingApprovals);
router.get('/users', getAllUsers);
router.get('/transactions', getAllTransactions);

router.put('/approve-user/:id', approveUser);
router.put('/reject-user/:id', rejectUser);
router.put('/approve-course/:id', approveCourse);
router.put('/reject-course/:id', rejectCourse);
router.put('/transactions/:id/status', updateTransactionStatus);

router.post('/broadcast', sendBroadcast);

// Admin chat monitoring
router.get('/chats', adminGetAllConversations);
router.get('/chats/:conversationId', adminGetConversation);

module.exports = router;
