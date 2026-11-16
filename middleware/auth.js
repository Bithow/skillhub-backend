const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');

if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set. Refusing to start with an insecure token secret.');
}
const jwtSecret = process.env.JWT_SECRET;
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret;

const publicUserSelect = {
    id: true,
    name: true,
    email: true,
    username: true,
    phone: true,
    role: true,
    status: true,
    country: true,
    walletBalance: true,
    profilePicture: true,
    bio: true,
    skills: true,
    rating: true,
    totalReviews: true,
    completedJobs: true,
    referralCode: true,
    referredById: true,
    lastLogin: true,
    createdAt: true,
    updatedAt: true
};

const loadAuthenticatedUser = async id => {
    const user = await prisma.user.findUnique({ where: { id }, select: publicUserSelect });
    return user ? { ...user, _id: user.id } : null;
};

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, jwtSecret);
            req.user = await loadAuthenticatedUser(decoded.id);
            
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: 'User not found'
                });
            }
            if (['suspended', 'rejected'].includes(req.user.status)) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account cannot access this resource'
                });
            }

            next();
        } catch (error) {
            console.error(error);
            return res.status(401).json({
                success: false,
                message: 'Not authorized, token failed'
            });
        }
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Not authorized, no token'
        });
    }
};

const optionalProtect = async (req, res, next) => {
    const authorization = req.headers.authorization;
    if (!authorization) return next();

    if (!authorization.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }

    try {
        const decoded = jwt.verify(authorization.split(' ')[1], jwtSecret);
        req.user = await loadAuthenticatedUser(decoded.id);
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }
        if (['suspended', 'rejected'].includes(req.user.status)) {
            return res.status(403).json({
                success: false,
                message: 'Your account cannot access this resource'
            });
        }
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Not authorized, token failed' });
    }
};

const generateToken = (id) => {
    return jwt.sign({ id }, jwtSecret, {
        expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    });
};

const generateRefreshToken = (id) => {
    return jwt.sign({ id }, jwtRefreshSecret, {
        expiresIn: '30d'
    });
};

module.exports = { protect, optionalProtect, generateToken, generateRefreshToken };