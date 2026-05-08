const User = require('../models/User');
const Course = require('../models/Course');
const Freelancer = require('../models/Freelancer');
const Transaction = require('../models/Transaction');
const WhatsAppService = require('../utils/whatsappService');

// @desc    Get dashboard stats
// @route   GET /api/admin/stats
// @access  Private (Admin only)
const getStats = async (req, res) => {
    try {
        const [
            totalUsers,
            pendingInstructors,
            pendingFreelancers,
            pendingCourses,
            totalCourses,
            totalFreelancers,
            totalRevenue,
            monthlyRevenue,
            totalTransactions
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ role: 'instructor', status: 'pending' }),
            User.countDocuments({ role: 'freelancer', status: 'pending' }),
            Course.countDocuments({ status: 'pending' }),
            Course.countDocuments({ status: 'published' }),
            Freelancer.countDocuments({ status: 'approved' }),
            Transaction.aggregate([
                { $match: { status: 'completed', type: 'commission' } },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Transaction.aggregate([
                { 
                    $match: { 
                        status: 'completed',
                        createdAt: { $gte: new Date(new Date().setDate(1)) }
                    }
                },
                { $group: { _id: null, total: { $sum: '$amount' } } }
            ]),
            Transaction.countDocuments()
        ]);
        
        res.json({
            success: true,
            stats: {
                totalUsers,
                pendingInstructors,
                pendingFreelancers,
                pendingCourses,
                totalCourses,
                totalFreelancers,
                totalRevenue: totalRevenue[0]?.total || 0,
                monthlyRevenue: monthlyRevenue[0]?.total || 0,
                totalTransactions
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get pending approvals
// @route   GET /api/admin/pending
// @access  Private (Admin only)
const getPendingApprovals = async (req, res) => {
    try {
        const [pendingInstructors, pendingFreelancers, pendingCourses] = await Promise.all([
            User.find({ role: 'instructor', status: 'pending' }).select('-password'),
            User.find({ role: 'freelancer', status: 'pending' }).select('-password'),
            Course.find({ status: 'pending' }).populate('instructorId', 'name email')
        ]);
        
        res.json({
            success: true,
            pending: {
                instructors: pendingInstructors,
                freelancers: pendingFreelancers,
                courses: pendingCourses
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Approve user (instructor/freelancer)
// @route   PUT /api/admin/approve-user/:id
// @access  Private (Admin only)
const approveUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { role, message } = req.body;
        
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        user.status = 'active';
        await user.save();
        
        // If freelancer — also activate their freelancer profile
        if (user.role === 'freelancer') {
            const Freelancer = require('../models/Freelancer');
            await Freelancer.findOneAndUpdate(
                { userId: user._id },
                { status: 'approved' }
            );
        }
        
        // If instructor — create freelancer profile if not exists
        if (user.role === 'instructor') {
            // Instructors don't need a freelancer profile, just activate user
        }
        
        // Send WhatsApp notification
        await WhatsAppService.sendToNumber(
            user.phone,
            `🎉 Congratulations! Your ${role || user.role} application has been APPROVED on SkillHub.\n\n${message || 'You can now start creating courses and earning money.'}\n\nLogin to your dashboard: ${process.env.FRONTEND_URL}`
        );
        
        res.json({
            success: true,
            message: 'User approved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Reject user
// @route   PUT /api/admin/reject-user/:id
// @access  Private (Admin only)
const rejectUser = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        
        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        user.status = 'rejected';
        await user.save();
        
        // Send rejection WhatsApp notification
        await WhatsAppService.sendToNumber(
            user.phone,
            `❌ Your ${user.role} application was not approved.\n\nReason: ${reason || 'Please check your information and reapply.'}\n\nContact support for more information.`
        );
        
        res.json({
            success: true,
            message: 'User rejected'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Approve course
// @route   PUT /api/admin/approve-course/:id
// @access  Private (Admin only)
const approveCourse = async (req, res) => {
    try {
        const course = await Course.findById(req.params.id).populate('instructorId');
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        course.status = 'published';
        await course.save();
        
        // Notify instructor via WhatsApp
        if (course.instructorId) {
            await WhatsAppService.sendToNumber(
                course.instructorId.phone,
                `🎉 Your course "${course.title}" has been APPROVED and is now live on SkillHub!\n\nShare it with your students: ${process.env.FRONTEND_URL}/courses/${course._id}`
            );
        }
        
        res.json({
            success: true,
            message: 'Course approved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Reject course
// @route   PUT /api/admin/reject-course/:id
// @access  Private (Admin only)
const rejectCourse = async (req, res) => {
    try {
        const { reason } = req.body;
        const course = await Course.findById(req.params.id).populate('instructorId');
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        course.status = 'rejected';
        course.rejectionReason = reason;
        await course.save();
        
        // Notify instructor via WhatsApp
        if (course.instructorId) {
            await WhatsAppService.sendToNumber(
                course.instructorId.phone,
                `❌ Your course "${course.title}" was not approved.\n\nReason: ${reason || 'Please review and resubmit.'}\n\nYou can edit and resubmit from your dashboard.`
            );
        }
        
        res.json({
            success: true,
            message: 'Course rejected'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get all users (with filters)
// @route   GET /api/admin/users
// @access  Private (Admin only)
const getAllUsers = async (req, res) => {
    try {
        const { page = 1, limit = 20, role, status, search } = req.query;
        
        const query = {};
        if (role) query.role = role;
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone: { $regex: search, $options: 'i' } }
            ];
        }
        
        const users = await User.find(query)
            .select('-password')
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort('-createdAt');
        
        const total = await User.countDocuments(query);
        
        res.json({
            success: true,
            users,
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

// @desc    Get all transactions
// @route   GET /api/admin/transactions
// @access  Private (Admin only)
const getAllTransactions = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, type } = req.query;
        
        const query = {};
        if (status) query.status = status;
        if (type) query.type = type;
        
        const transactions = await Transaction.find(query)
            .populate('userId', 'name email')
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

// @desc    Update transaction status
// @route   PUT /api/admin/transactions/:id/status
// @access  Private (Admin only)
const updateTransactionStatus = async (req, res) => {
    try {
        const { status } = req.body;
        const transaction = await Transaction.findById(req.params.id);
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        transaction.status = status;
        if (status === 'completed') {
            transaction.completedAt = Date.now();
        }
        await transaction.save();
        
        // Add to user's wallet if completed
        if (status === 'completed' && transaction.type === 'withdrawal') {
            await User.findByIdAndUpdate(transaction.userId, {
                $inc: { walletBalance: -transaction.amount }
            });
        }
        
        res.json({
            success: true,
            transaction
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Send broadcast WhatsApp message
// @route   POST /api/admin/broadcast
// @access  Private (Admin only)
const sendBroadcast = async (req, res) => {
    try {
        const { message, role, batchSize = 100 } = req.body;
        
        const query = { status: 'active' };
        if (role) query.role = role;
        
        const users = await User.find(query).select('phone');
        
        let sent = 0;
        for (let i = 0; i < users.length; i += batchSize) {
            const batch = users.slice(i, i + batchSize);
            await Promise.all(batch.map(user => 
                WhatsAppService.sendToNumber(user.phone, message).catch(err => console.error(err))
            ));
            sent += batch.length;
            // Delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        res.json({
            success: true,
            message: `Broadcast sent to ${sent} users`,
            total: users.length,
            sent
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
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
};