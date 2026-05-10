const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const WhatsAppService = require('../utils/whatsappService');

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
    try {
        const { name, email, phone, password, role, referralCode } = req.body;

        // Check if user exists
        const userExists = await User.findOne({ $or: [{ email }, { phone }] });
        if (userExists) {
            return res.status(400).json({
                success: false,
                message: 'User already exists with this email or phone'
            });
        }

        // Create user — learners active immediately, instructors/freelancers need admin approval
        const user = await User.create({
            name,
            email,
            phone,
            password,
            role,
            status: (role === 'user' || role === 'admin') ? 'active' : 'pending',
            country: req.body.country || 'ET',
            bio: req.body.bio || '',
            skills: req.body.skills || [],
            profilePicture: req.body.profilePicture || ''
        });

        // Auto-create freelancer profile if role is freelancer (pending until admin approves)
        if (role === 'freelancer') {
            const Freelancer = require('../models/Freelancer');
            await Freelancer.create({
                userId: user._id,
                title: req.body.expertise || 'Freelance Professional',
                skills: req.body.skills || [],
                hourlyRate: req.body.hourlyRate || 100,
                portfolio: req.body.portfolio ? [{ title: 'Portfolio', projectUrl: req.body.portfolio }] : [],
                status: 'pending',
                availability: 'available'
            });
        }

        // Handle referral
        if (referralCode) {
            const referrer = await User.findOne({ referralCode });
            if (referrer) {
                user.referredBy = referrer._id;
                await user.save();
                
                // Give referral bonus
                await Transaction.create({
                    userId: referrer._id,
                    type: 'referral_bonus',
                    amount: 50,
                    netAmount: 50,
                    status: 'completed',
                    paymentMethod: 'wallet',
                    description: `Referral bonus for inviting ${name}`
                });
                
                // Update referrer wallet
                await User.findByIdAndUpdate(referrer._id, { $inc: { walletBalance: 50 } });
            }
        }

        // Send WhatsApp notification to admin
        const roleEmoji = role === 'instructor' ? '👨‍🏫' : role === 'freelancer' ? '💼' : '🎓';
        await WhatsAppService.sendToAdmin(
            `${roleEmoji} New ${role} joined SkillHub!\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nRole: ${role}\n\nThey are now active. Review their profile at:\n${process.env.FRONTEND_URL || 'https://remarkable-semolina-273e83.netlify.app'}`
        );

        // Generate token
        const token = generateToken(user._id);
        const refreshToken = generateRefreshToken(user._id);

        res.status(201).json({
            success: true,
            token,
            refreshToken,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                status: user.status,
                walletBalance: user.walletBalance
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Check for user
        const user = await User.findOne({ email }).select('+password');
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check password
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check if user is suspended
        if (user.status === 'suspended') {
            return res.status(403).json({
                success: false,
                message: 'Your account has been suspended. Please contact support.'
            });
        }

        // Update last login
        user.lastLogin = Date.now();
        await user.save();

        // Generate token
        const token = generateToken(user._id);
        const refreshToken = generateRefreshToken(user._id);

        res.json({
            success: true,
            token,
            refreshToken,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                status: user.status,
                walletBalance: user.walletBalance,
                profilePicture: user.profilePicture
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
const getMe = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('-password')
            .populate('courses')
            .populate('freelancerProfile');

        res.json({
            success: true,
            user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
const updateProfile = async (req, res) => {
    try {
        const { name, bio, skills, profilePicture, phone, country } = req.body;
        
        const user = await User.findById(req.user._id);
        
        if (name) user.name = name;
        if (bio !== undefined) user.bio = bio;
        if (skills) user.skills = skills;
        if (profilePicture !== undefined) user.profilePicture = profilePicture;
        if (phone) {
            // Check phone not taken by another user
            const phoneExists = await User.findOne({ phone, _id: { $ne: user._id } });
            if (phoneExists) {
                return res.status(400).json({ success: false, message: 'Phone number already in use' });
            }
            user.phone = phone;
        }
        if (country) user.country = country.toUpperCase();
        
        await user.save();

        res.json({
            success: true,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                country: user.country,
                bio: user.bio,
                skills: user.skills,
                profilePicture: user.profilePicture
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Change password
// @route   PUT /api/auth/change-password
// @access  Private
const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        const user = await User.findById(req.user._id).select('+password');
        
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }
        
        user.password = newPassword;
        await user.save();
        
        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Forgot password - send reset code via WhatsApp
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
    try {
        const { phone } = req.body;
        
        const user = await User.findOne({ phone });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found with this phone number'
            });
        }
        
        // Generate reset code (6 digits)
        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Save reset code to user (add field to schema)
        user.resetCode = resetCode;
        user.resetCodeExpires = Date.now() + 3600000; // 1 hour
        await user.save();
        
        // Send reset code via WhatsApp
        await WhatsAppService.sendToNumber(phone, `🔐 Your SkillHub password reset code is: ${resetCode}\nValid for 1 hour.`);
        
        res.json({
            success: true,
            message: 'Reset code sent to your WhatsApp'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Reset password
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res) => {
    try {
        const { phone, code, newPassword } = req.body;
        
        const user = await User.findOne({
            phone,
            resetCode: code,
            resetCodeExpires: { $gt: Date.now() }
        });
        
        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset code'
            });
        }
        
        user.password = newPassword;
        user.resetCode = undefined;
        user.resetCodeExpires = undefined;
        await user.save();
        
        res.json({
            success: true,
            message: 'Password reset successful'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    register,
    login,
    getMe,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword
};