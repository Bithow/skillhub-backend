const express = require('express');
const multer = require('multer');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
    createCheckout,
    simulateCoursePayment,
    verifyPayment,
    getTransactionStatus,
    requestWithdrawal,
    getMyTransactions,
    addFunds
} = require('../controllers/paymentController');
const {
    getMyFinancialSummary,
    requestWithdrawal: createWithdrawalRequest,
    createRefundRequest,
    getMyRefundRequests
} = require('../controllers/financeController');

const receiptUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter: (req, file, callback) => {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
            return callback(new Error('Receipt must be a JPEG, PNG, or WEBP image'));
        }
        callback(null, true);
    }
});

router.use(protect);

router.post('/checkout', createCheckout);
router.post('/simulate', simulateCoursePayment);
router.get('/financial-summary', getMyFinancialSummary);
router.post('/withdrawal-requests', createWithdrawalRequest);
router.get('/refund-requests', getMyRefundRequests);
router.post('/refund-requests', createRefundRequest);
router.get('/transactions', getMyTransactions);
router.get('/transactions/:id', getTransactionStatus);
router.post('/verify', verifyPayment);
router.post('/submit-receipt', receiptUpload.single('receiptImage'), verifyPayment);
router.post('/submit', verifyPayment);
router.post('/withdraw', requestWithdrawal);
router.post('/add-funds', addFunds);

module.exports = router;