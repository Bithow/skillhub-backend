const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Course = require('../models/Course');
const WhatsAppService = require('../utils/whatsappService');
const axios = require('axios');

// @desc    Verify payment (Telebirr/CBE/WhatsApp)
// @route   POST /api/payments/verify
// @access  Private
const verifyPayment = async (req, res) => {
    try {
        const { reference, transactionId, paymentProof } = req.body;
        
        const transaction = await Transaction.findOne({ reference });
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        if (transaction.status === 'completed') {
            return res.status(400).json({
                success: false,
                message: 'Transaction already completed'
            });
        }
        
        // Update transaction
        transaction.status = 'completed';
        transaction.completedAt = Date.now();
        transaction.metadata.paymentProof = paymentProof;
        await transaction.save();
        
        // If course purchase, enroll student
        if (transaction.type === 'course_purchase' && transaction.metadata.courseId) {
            const course = await Course.findById(transaction.metadata.courseId);
            if (course) {
                course.students.push({
                    userId: transaction.userId,
                    enrolledAt: Date.now()
                });
                await course.save();
                
                // Add to instructor's earnings
                const instructor = await User.findById(course.instructorId);
                if (instructor) {
                    instructor.walletBalance += transaction.netAmount;
                    await instructor.save();
                }
                
                // Notify student via WhatsApp
                await WhatsAppService.sendToNumber(
                    transaction.user.phone,
                    `🎉 Congratulations! You are now enrolled in "${course.title}".\n\nAccess your course: ${process.env.FRONTEND_URL}/my-courses`
                );
            }
        }
        
        res.json({
            success: true,
            message: 'Payment verified successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Request withdrawal
// @route   POST /api/payments/withdraw
// @access  Private
const requestWithdrawal = async (req, res) => {
    try {
        const { amount, phoneNumber, method } = req.body;
        
        if (amount < 100) {
            return res.status(400).json({
                success: false,
                message: 'Minimum withdrawal amount is 100 ETB'
            });
        }
        
        if (req.user.walletBalance < amount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }
        
        const transaction = await Transaction.create({
            userId: req.user._id,
            type: 'withdrawal',
            amount: amount,
            netAmount: amount,
            status: 'pending',
            paymentMethod: method || 'telebirr',
            metadata: { phoneNumber: phoneNumber || req.user.phone }
        });
        
        // Notify admin for manual processing
        await WhatsAppService.sendToAdmin(
            `💰 Withdrawal Request\nUser: ${req.user.name}\nAmount: ${amount} ETB\nPhone: ${phoneNumber || req.user.phone}\nReference: ${transaction.reference}`
        );
        
        res.json({
            success: true,
            message: 'Withdrawal request submitted. You will be notified when processed.',
            transaction
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get user's transaction history
// @route   GET /api/payments/transactions
// @access  Private
const getMyTransactions = async (req, res) => {
    try {
        const { page = 1, limit = 20, type } = req.query;
        
        const query = { userId: req.user._id };
        if (type) query.type = type;
        
        const transactions = await Transaction.find(query)
            .sort('-createdAt')
            .limit(limit * 1)
            .skip((page - 1) * limit);
        
        const total = await Transaction.countDocuments(query);
        
        res.json({
            success: true,
            transactions,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Add money to wallet
// @route   POST /api/payments/add-funds
// @access  Private
const addFunds = async (req, res) => {
    try {
        const { amount, paymentMethod } = req.body;
        
        if (amount < 10) {
            return res.status(400).json({
                success: false,
                message: 'Minimum deposit is 10 ETB'
            });
        }
        
        const transaction = await Transaction.create({
            userId: req.user._id,
            type: 'deposit',
            amount: amount,
            netAmount: amount,
            status: 'pending',
            paymentMethod: paymentMethod || 'telebirr'
        });
        
        // Generate Telegram/Telebirr payment link (simplified)
        const paymentLink = `https://api.telebirr.et/pay?amount=${amount}&reference=${transaction.reference}`;
        
        await WhatsAppService.sendToNumber(
            req.user.phone,
            `💰 Add Funds to Wallet\nAmount: ${amount} ETB\nReference: ${transaction.reference}\n\nClick to pay: ${paymentLink}\n\nReply with "PAID ${transaction.reference}" after completing payment.`
        );
        
        res.json({
            success: true,
            message: 'Payment link sent to your WhatsApp',
            transaction
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    verifyPayment,
    requestWithdrawal,
    getMyTransactions,
    addFunds
};