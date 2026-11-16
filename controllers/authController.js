const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { generateToken, generateRefreshToken } = require('../middleware/auth');
const WhatsAppService = require('../utils/whatsappService');
const EmailService = require('../utils/email');

const mapApiRelations = value => {
    if (!value) return value;
    if (Array.isArray(value)) return value.map(mapApiRelations);
    if (typeof value !== 'object' || value instanceof Date) return value;
    const mapped = {};
    for (const [key, nested] of Object.entries(value)) {
        const apiKey = key === 'freelancer' ? 'freelancerProfile'
            : key === 'instructor' ? 'instructorId'
                : key === 'user' ? 'userId'
                    : key === 'sender' ? 'senderId'
                        : key === 'receiver' ? 'receiverId'
                            : key;
        mapped[apiKey] = mapApiRelations(nested);
    }
    if (mapped.id && !mapped._id) mapped._id = mapped.id;
    return mapped;
};

const apiUser = (user) => {
    if (!user) return user;
    const {
        id,
        password,
        resetCode,
        resetCodeExpires,
        ...fields
    } = user;
    return mapApiRelations({ ...fields, _id: id, id });
};

const isUniqueConstraintError = error => error.code === 'P2002';

// @desc    Register user
// @route   POST /api/auth/register
// @access  Public
const register = async (req, res) => {
    try {
        const { name, email, username, phone, password, referralCode } = req.body;
        const role = req.body.role || 'user';
        const normalizedUsername = typeof username === 'string'
            ? username.trim().toLowerCase() || undefined
            : undefined;
        if (!['user', 'instructor', 'freelancer', 'client'].includes(role)) {
            return res.status(403).json({
                success: false,
                message: 'This role cannot be assigned during public registration'
            });
        }

        const normalizedEmail = email.trim().toLowerCase();
        let user;
        try {
            user = await prisma.$transaction(async tx => {
                const referrer = referralCode
                    ? await tx.user.findUnique({ where: { referralCode } })
                    : null;
                const createdUser = await tx.user.create({
                    data: {
                        name: name.trim(),
                        email: normalizedEmail,
                        username: normalizedUsername,
                        phone: phone || null,
                        password: await bcrypt.hash(password, 10),
                        role,
                        status: ['instructor', 'freelancer'].includes(role) ? 'pending' : 'active',
                        country: (req.body.country || 'ET').toUpperCase(),
                        bio: req.body.bio || '',
                        skills: req.body.skills || [],
                        profilePicture: req.body.profilePicture || null,
                        referralCode: `${crypto.randomBytes(6).toString('hex')}_${crypto.randomBytes(3).toString('hex')}`,
                        referredById: referrer?.id
                    }
                });

                if (role === 'freelancer') {
                    await tx.freelancer.create({
                        data: {
                            userId: createdUser.id,
                            title: req.body.expertise || 'Freelance Professional',
                            skills: req.body.skills || [],
                            hourlyRate: Number(req.body.hourlyRate) || 100,
                            portfolio: req.body.portfolio
                                ? [{ title: 'Portfolio', projectUrl: req.body.portfolio }]
                                : [],
                            status: 'pending',
                            availability: 'available'
                        }
                    });
                }

                if (referrer) {
                    await tx.transaction.create({
                        data: {
                            userId: referrer.id,
                            type: 'referral_bonus',
                            amount: 50,
                            netAmount: 50,
                            status: 'completed',
                            paymentMethod: 'wallet',
                            reference: `TXN_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
                            description: `Referral bonus for inviting ${name}`
                        }
                    });
                    await tx.user.update({
                        where: { id: referrer.id },
                        data: { walletBalance: { increment: 50 } }
                    });
                }

                return createdUser;
            });
        } catch (error) {
            if (isUniqueConstraintError(error)) {
                const target = error.meta?.target || [];
                const message = target.includes('email')
                    ? 'An account with this email already exists. Please login instead.'
                    : target.includes('username')
                        ? 'This username is already taken. Please choose another one.'
                        : 'This phone number is already registered. Please use a different number or leave it blank.';
                return res.status(400).json({ success: false, message });
            }
            throw error;
        }

        // Send WhatsApp notification to admin
        const roleEmoji = role === 'instructor' ? '👨‍🏫' : role === 'freelancer' || role === 'client' ? '💼' : '🎓';
        await WhatsAppService.sendToAdmin(
            `${roleEmoji} New ${role} joined SkillHub!\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nRole: ${role}\n\nThey are now active. Review their profile at:\n${process.env.FRONTEND_URL || 'https://remarkable-semolina-273e83.netlify.app'}`
        );

        // Generate token
        const token = generateToken(user.id);
        const refreshToken = generateRefreshToken(user.id);

        res.status(201).json({
            success: true,
            token,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                username: user.username,
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
        const { identifier: suppliedIdentifier, email, username, password } = req.body;
        const identifier = (suppliedIdentifier || email || username || '').trim();
        const where = identifier.includes('@')
            ? { email: identifier.toLowerCase() }
            : { username: identifier.toLowerCase() };
        const user = await prisma.user.findUnique({ where });
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Check if user is suspended
        if (['suspended', 'rejected'].includes(user.status)) {
            return res.status(403).json({
                success: false,
                message: 'Your account has been suspended. Please contact support.'
            });
        }

        // Update last login
        await prisma.user.update({ where: { id: user.id }, data: { lastLogin: new Date() } });

        // Generate token
        const token = generateToken(user.id);
        const refreshToken = generateRefreshToken(user.id);

        res.json({
            success: true,
            token,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                username: user.username,
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
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { courses: true, freelancer: true }
        });

        res.json({
            success: true,
            user: apiUser(user)
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
        
        const data = {};
        if (name) data.name = name.trim();
        if (bio !== undefined) data.bio = bio;
        if (skills) data.skills = skills;
        if (profilePicture !== undefined) data.profilePicture = profilePicture || null;
        if (phone) {
            data.phone = phone;
        }
        if (country) data.country = country.toUpperCase();

        let user;
        try {
            user = await prisma.user.update({ where: { id: req.user.id }, data });
        } catch (error) {
            if (isUniqueConstraintError(error) && (error.meta?.target || []).includes('phone')) {
                return res.status(400).json({ success: false, message: 'Phone number already in use' });
            }
            throw error;
        }

        res.json({
            success: true,
            user: {
                id: user.id,
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
        
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        const isMatch = user && await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }
        
        await prisma.user.update({
            where: { id: req.user.id },
            data: { password: await bcrypt.hash(newPassword, 10) }
        });
        
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

// @desc    Send a password reset code
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res) => {
    try {
        const { email, phone } = req.body;
        const normalizedEmail = email && email.trim().toLowerCase();
        const user = normalizedEmail
            ? await prisma.user.findUnique({ where: { email: normalizedEmail } })
            : await prisma.user.findUnique({ where: { phone } });
        const genericResponse = {
            success: true,
            message: 'If an account matches, password reset instructions have been sent.'
        };
        if (!user) return res.json(genericResponse);

        const resetCode = crypto.randomInt(100000, 1000000).toString();
        await prisma.user.update({
            where: { id: user.id },
            data: { resetCode, resetCodeExpires: new Date(Date.now() + 15 * 60 * 1000) }
        });

        const delivered = normalizedEmail
            ? await EmailService.sendEmail(
                user.email,
                'SkillHub password reset code',
                `<p>Your SkillHub password reset code is <strong>${resetCode}</strong>.</p><p>It expires in 15 minutes. If you did not request this, you can ignore this message.</p>`
            )
            : await WhatsAppService.sendToNumber(
                user.phone,
                `Your SkillHub password reset code is: ${resetCode}. It expires in 15 minutes.`
            );

        if (!delivered) {
            await prisma.user.update({
                where: { id: user.id },
                data: { resetCode: null, resetCodeExpires: null }
            });
            console.error('Password reset instructions could not be delivered');
        }

        res.json(genericResponse);
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
        const { email, phone, code, newPassword } = req.body;
        const identity = email
            ? { email: email.trim().toLowerCase() }
            : { phone };
        const user = await prisma.user.findFirst({
            where: {
                ...identity,
                resetCode: code,
                resetCodeExpires: { gt: new Date() }
            }
        });
        
        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Invalid or expired reset code'
            });
        }
        
        await prisma.user.update({
            where: { id: user.id },
            data: {
                password: await bcrypt.hash(newPassword, 10),
                resetCode: null,
                resetCodeExpires: null
            }
        });
        
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