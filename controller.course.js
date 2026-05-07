const Course = require('../models/Course');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const WhatsAppService = require('../utils/whatsappService');

// @desc    Create a new course
// @route   POST /api/courses
// @access  Private (Instructor only)
const createCourse = async (req, res) => {
    try {
        const { title, description, price, category, level, duration, tags } = req.body;
        
        // Check if user is approved instructor
        const user = await User.findById(req.user._id);
        if (user.role !== 'instructor' || user.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Only approved instructors can create courses'
            });
        }
        
        const course = await Course.create({
            title,
            description,
            price,
            category,
            level,
            duration,
            tags,
            instructorId: req.user._id,
            instructorName: user.name,
            instructorPhone: user.phone,
            status: 'pending'
        });
        
        // Notify admin via WhatsApp
        await WhatsAppService.sendToAdmin(
            `📚 New Course Pending Approval\nTitle: ${title}\nInstructor: ${user.name}\nPrice: ${price} ETB`
        );
        
        res.status(201).json({
            success: true,
            course
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get all approved courses
// @route   GET /api/courses
// @access  Public
const getCourses = async (req, res) => {
    try {
        const { page = 1, limit = 20, category, minPrice, maxPrice, search, sort = '-createdAt' } = req.query;
        
        const query = { status: 'published' };
        
        if (category) query.category = category;
        if (minPrice || maxPrice) {
            query.price = {};
            if (minPrice) query.price.$gte = parseFloat(minPrice);
            if (maxPrice) query.price.$lte = parseFloat(maxPrice);
        }
        if (search) {
            query.$text = { $search: search };
        }
        
        const courses = await Course.find(query)
            .populate('instructorId', 'name rating')
            .sort(sort)
            .limit(limit * 1)
            .skip((page - 1) * limit);
        
        const total = await Course.countDocuments(query);
        
        res.json({
            success: true,
            courses,
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

// @desc    Get single course
// @route   GET /api/courses/:id
// @access  Public
const getCourseById = async (req, res) => {
    try {
        const course = await Course.findById(req.params.id)
            .populate('instructorId', 'name email phone rating totalReviews');
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Increment view count
        course.views += 1;
        await course.save();
        
        res.json({
            success: true,
            course
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Update course
// @route   PUT /api/courses/:id
// @access  Private (Instructor only)
const updateCourse = async (req, res) => {
    try {
        const course = await Course.findById(req.params.id);
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Check ownership
        if (course.instructorId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to update this course'
            });
        }
        
        const { title, description, price, category, level, duration, tags, thumbnail } = req.body;
        
        if (title) course.title = title;
        if (description) course.description = description;
        if (price) course.price = price;
        if (category) course.category = category;
        if (level) course.level = level;
        if (duration) course.duration = duration;
        if (tags) course.tags = tags;
        if (thumbnail) course.thumbnail = thumbnail;
        
        course.status = 'pending'; // Re-submit for approval
        await course.save();
        
        res.json({
            success: true,
            course
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Delete course
// @route   DELETE /api/courses/:id
// @access  Private (Instructor/Admin)
const deleteCourse = async (req, res) => {
    try {
        const course = await Course.findById(req.params.id);
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Check ownership
        if (course.instructorId.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to delete this course'
            });
        }
        
        await course.deleteOne();
        
        res.json({
            success: true,
            message: 'Course deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Purchase course
// @route   POST /api/courses/:id/purchase
// @access  Private
const purchaseCourse = async (req, res) => {
    try {
        const course = await Course.findById(req.params.id);
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Check if already enrolled
        const alreadyEnrolled = course.students.some(s => s.userId.toString() === req.user._id.toString());
        if (alreadyEnrolled) {
            return res.status(400).json({
                success: false,
                message: 'Already enrolled in this course'
            });
        }
        
        const commission = course.price * 0.2; // 20% platform commission
        const instructorEarning = course.price - commission;
        
        // Create transaction
        const transaction = await Transaction.create({
            userId: req.user._id,
            type: 'course_purchase',
            amount: course.price,
            commission: commission,
            netAmount: instructorEarning,
            status: 'pending',
            paymentMethod: 'whatsapp',
            metadata: { courseId: course._id }
        });
        
        // Send WhatsApp payment link/message
        const paymentMessage = `🎓 Course Purchase: ${course.title}\n💰 Amount: ${course.price} ETB\n📝 Reference: ${transaction.reference}\n\nSend payment to: 09XX-XXXXXX (Telebirr/CBE)\nReply with "PAID ${transaction.reference}" after payment`;
        
        await WhatsAppService.sendToNumber(req.user.phone, paymentMessage);
        
        res.json({
            success: true,
            message: 'Payment instruction sent to your WhatsApp',
            transaction: {
                reference: transaction.reference,
                amount: course.price,
                courseTitle: course.title
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Add review to course
// @route   POST /api/courses/:id/review
// @access  Private
const addReview = async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const course = await Course.findById(req.params.id);
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Check if user is enrolled
        const isEnrolled = course.students.some(s => s.userId.toString() === req.user._id.toString());
        if (!isEnrolled) {
            return res.status(403).json({
                success: false,
                message: 'You must be enrolled to review this course'
            });
        }
        
        // Check if already reviewed
        const alreadyReviewed = course.reviews.some(r => r.userId.toString() === req.user._id.toString());
        if (alreadyReviewed) {
            return res.status(400).json({
                success: false,
                message: 'You have already reviewed this course'
            });
        }
        
        course.reviews.push({
            userId: req.user._id,
            userName: req.user.name,
            rating,
            comment
        });
        
        course.calculateRating();
        await course.save();
        
        res.json({
            success: true,
            message: 'Review added successfully',
            rating: course.rating
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get courses by instructor
// @route   GET /api/courses/instructor/:instructorId
// @access  Public
const getInstructorCourses = async (req, res) => {
    try {
        const courses = await Course.find({
            instructorId: req.params.instructorId,
            status: 'published'
        });
        
        res.json({
            success: true,
            courses
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    createCourse,
    getCourses,
    getCourseById,
    updateCourse,
    deleteCourse,
    purchaseCourse,
    addReview,
    getInstructorCourses
};