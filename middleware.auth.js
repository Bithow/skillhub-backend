const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = await User.findById(decoded.id).select('-password');
            
            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: 'User not found'
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

const jwtSecret = process.env.JWT_SECRET || 'skillhub-dev-secret';
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || jwtSecret;

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

module.exports = { protect, generateToken, generateRefreshToken };