const Freelancer = require('../models/Freelancer');
const User = require('../models/User');
const WhatsAppService = require('../utils/whatsappService');

// @desc    Create freelancer profile
// @route   POST /api/freelancers
// @access  Private
const createFreelancerProfile = async (req, res) => {
    try {
        const { title, skills, hourlyRate, experience, portfolio, availability } = req.body;
        
        // Check if user already has a freelancer profile
        const existing = await Freelancer.findOne({ userId: req.user._id });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'You already have a freelancer profile'
            });
        }
        
        const freelancer = await Freelancer.create({
            userId: req.user._id,
            title,
            skills,
            hourlyRate,
            experience,
            portfolio: portfolio || [],
            availability: availability || 'available',
            status: 'pending'
        });
        
        // Update user role if not already freelancer
        if (req.user.role !== 'freelancer') {
            await User.findByIdAndUpdate(req.user._id, { role: 'freelancer' });
        }
        
        // Notify admin
        await WhatsAppService.sendToAdmin(
            `👨‍💻 New Freelancer Registration\nName: ${req.user.name}\nSkills: ${skills.join(', ')}\nRate: $${Number(hourlyRate).toFixed(2)} USD/hr`
        );
        
        res.status(201).json({
            success: true,
            freelancer
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get all approved freelancers
// @route   GET /api/freelancers
// @access  Public
const getFreelancers = async (req, res) => {
    try {
        const { page = 1, limit = 20, skill, minRate, maxRate, search } = req.query;
        
        const query = { status: 'approved' };
        
        if (skill) query.skills = { $in: [skill] };
        if (minRate || maxRate) {
            query.hourlyRate = {};
            if (minRate) query.hourlyRate.$gte = parseFloat(minRate);
            if (maxRate) query.hourlyRate.$lte = parseFloat(maxRate);
        }
        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { skills: { $in: [new RegExp(search, 'i')] } }
            ];
        }
        
        const freelancers = await Freelancer.find(query)
            .populate('userId', 'name rating profilePicture totalReviews')
            .limit(limit * 1)
            .skip((page - 1) * limit)
            .sort('-rating');
        
        const total = await Freelancer.countDocuments(query);
        
        res.json({
            success: true,
            freelancers,
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

// @desc    Get single freelancer
// @route   GET /api/freelancers/:id
// @access  Public
const getFreelancerById = async (req, res) => {
    try {
        const freelancer = await Freelancer.findById(req.params.id)
            .populate('userId', 'name email phone rating profilePicture bio');
        
        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }
        
        // Increment view count
        freelancer.views += 1;
        await freelancer.save();
        
        res.json({
            success: true,
            freelancer
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Update freelancer profile
// @route   PUT /api/freelancers
// @access  Private
const updateFreelancerProfile = async (req, res) => {
    try {
        const { title, skills, hourlyRate, experience, portfolio, availability } = req.body;
        
        const freelancer = await Freelancer.findOne({ userId: req.user._id });
        
        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer profile not found'
            });
        }
        
        if (title) freelancer.title = title;
        if (skills) freelancer.skills = skills;
        if (hourlyRate) freelancer.hourlyRate = hourlyRate;
        if (experience) freelancer.experience = experience;
        if (portfolio) freelancer.portfolio = portfolio;
        if (availability) freelancer.availability = availability;
        
        await freelancer.save();
        
        res.json({
            success: true,
            freelancer
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get current user's freelancer profile
// @route   GET /api/freelancers/me
// @access  Private
const getMyFreelancerProfile = async (req, res) => {
    try {
        const freelancer = await Freelancer.findOne({ userId: req.user._id });
        
        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer profile not found'
            });
        }
        
        res.json({
            success: true,
            freelancer
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Contact freelancer (get WhatsApp number after payment)
// @route   POST /api/freelancers/:id/contact
// @access  Private
const contactFreelancer = async (req, res) => {
    try {
        const freelancer = await Freelander.findById(req.params.id).populate('userId');
        
        if (!freelancer) {
            return res.status(404).json({
                success: false,
                message: 'Freelancer not found'
            });
        }
        
        const contactFee = 15;
        
        // Check if user has enough wallet balance
        if (req.user.walletBalance < contactFee) {
            return res.status(400).json({
                success: false,
                message: `Insufficient balance. Please add $${contactFee.toFixed(2)} USD to your wallet`,
                requiredAmount: contactFee,
                currentBalance: req.user.walletBalance
            });
        }
        
        // Deduct fee
        req.user.walletBalance -= contactFee;
        await req.user.save();
        
        // Create transaction record
        await Transaction.create({
            userId: req.user._id,
            type: 'freelance_hire',
            amount: contactFee,
            netAmount: contactFee,
            status: 'completed',
            paymentMethod: 'wallet',
            metadata: { freelancerId: freelancer._id }
        });
        
        // Return freelancer's WhatsApp number
        res.json({
            success: true,
            message: 'Contact information unlocked',
            freelancer: {
                name: freelancer.userId.name,
                phone: freelancer.userId.phone,
                whatsappNumber: freelancer.userId.phone
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    createFreelancerProfile,
    getFreelancers,
    getFreelancerById,
    updateFreelancerProfile,
    getMyFreelancerProfile,
    contactFreelancer
};