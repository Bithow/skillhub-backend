const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
    verifyPayment,
    requestWithdrawal,
    getMyTransactions,
    addFunds
} = require('../controllers/paymentController');

router.use(protect);

router.get('/transactions', getMyTransactions);
router.post('/verify', verifyPayment);
router.post('/withdraw', requestWithdrawal);
router.post('/add-funds', addFunds);

module.exports = router;