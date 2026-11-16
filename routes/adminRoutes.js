const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { roleCheck } = require('../middleware/roleCheck');
const { permissionCheck } = require('../middleware/adminPermission');
const {
    getAiStudioStatus,
    listAiStudioJobs,
    createCourseGenerationJob,
    retryAiStudioJob,
    getAiStudioUsage
} = require('../controllers/aiStudioController');
const { getSiteVisitAnalytics } = require('../controllers/analyticsController');
const {
    getStats,
    getPendingApprovals,
    approveUser,
    rejectUser,
    approveCourse,
    rejectCourse,
    setCourseFeatured,
    getAllUsers,
    getAllTransactions,
    updateTransactionStatus,
    sendBroadcast,
    getExchangeRates,
    updateExchangeRates,
    getCommissionSettings,
    updateCommissionSettings,
    getFinancialReport,
    getAdminRoleCatalog,
    getAdminRoleUsers,
    updateAdminRolePermissions,
    getAdminActivityLogs,
    searchAdminRecords,
    getBusinessInquiries,
    updateBusinessInquiryStatus,
    getSupportTickets,
    updateSupportTicketStatus,
    getReportsComplaints,
    updateReportComplaintStatus,
    getAdminNotifications,
    createAdminNotification,
    markAdminNotificationRead
} = require('../controllers/adminController');
const {
    getAdminWithdrawalRequests,
    reviewWithdrawalRequest,
    getAdminRefundRequests,
    reviewRefundRequest,
    getAdminFreelancePaymentReports,
    reviewFreelancePaymentReport
} = require('../controllers/financeController');

// All admin routes require authentication + admin role
router.use(protect);
router.use(roleCheck('admin'));

router.get('/ai-studio/status', permissionCheck('ai_studio:view'), getAiStudioStatus);
router.get('/ai-studio/jobs', permissionCheck('ai_studio:view'), listAiStudioJobs);
router.get('/ai-studio/usage', permissionCheck('ai_studio:view'), getAiStudioUsage);
router.post('/ai-studio/courses', permissionCheck('ai_studio:manage'), createCourseGenerationJob);
router.post('/ai-studio/jobs/:id/retry', permissionCheck('ai_studio:manage'), retryAiStudioJob);
router.get('/site-visits', permissionCheck('analytics:view'), getSiteVisitAnalytics);

router.get('/stats', getStats);
router.get('/pending', getPendingApprovals);
router.get('/users', getAllUsers);
router.get('/transactions', getAllTransactions);
router.get('/settings/exchange-rates', getExchangeRates);
router.get('/settings/commission', getCommissionSettings);
router.put('/settings/commission', updateCommissionSettings);
router.get('/roles/catalog', getAdminRoleCatalog);
router.get('/roles', getAdminRoleUsers);
router.put('/roles/:id', updateAdminRolePermissions);
router.get('/activity', getAdminActivityLogs);
router.get('/inquiries', getBusinessInquiries);
router.put('/inquiries/:id/status', updateBusinessInquiryStatus);
router.get('/tickets', getSupportTickets);
router.put('/tickets/:id/status', updateSupportTicketStatus);
router.get('/reports', getReportsComplaints);
router.put('/reports/:id/status', updateReportComplaintStatus);
router.get('/notifications', getAdminNotifications);
router.post('/notifications', createAdminNotification);
router.put('/notifications/:id/read', markAdminNotificationRead);
router.get('/search', searchAdminRecords);
router.get('/financial-report', getFinancialReport);
router.get('/withdrawal-requests', getAdminWithdrawalRequests);
router.put('/withdrawal-requests/:id/review', reviewWithdrawalRequest);
router.get('/refund-requests', getAdminRefundRequests);
router.put('/refund-requests/:id/review', reviewRefundRequest);
router.get('/freelance-payment-reports', getAdminFreelancePaymentReports);
router.put('/freelance-payment-reports/:id/review', reviewFreelancePaymentReport);

router.put('/approve-user/:id', approveUser);
router.put('/reject-user/:id', rejectUser);
router.put('/approve-course/:id', approveCourse);
router.put('/reject-course/:id', rejectCourse);
router.put('/courses/:id/featured', setCourseFeatured);
router.put('/transactions/:id/status', updateTransactionStatus);
router.put('/transactions/:id/approve', (req, res) => {
    req.body = { ...req.body, status: 'completed' };
    return updateTransactionStatus(req, res);
});
router.put('/transactions/:id/reject', (req, res) => {
    req.body = { ...req.body, status: 'failed' };
    return updateTransactionStatus(req, res);
});

router.post('/broadcast', sendBroadcast);
router.post('/settings/exchange-rates', updateExchangeRates);

module.exports = router;
