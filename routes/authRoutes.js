const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { validate, userValidation } = require('../middleware/validation');
const {
    register,
    login,
    getMe,
    updateProfile,
    changePassword,
    forgotPassword,
    resetPassword
} = require('../controllers/authController');
const { searchUsers } = require('../controllers/chatController');

const recoveryLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false
});

router.post('/register', userValidation.register, validate, register);
router.post('/login', userValidation.login, validate, login);
router.post('/forgot-password', recoveryLimiter, userValidation.forgotPassword, validate, forgotPassword);
router.post('/reset-password', recoveryLimiter, userValidation.resetPassword, validate, resetPassword);
router.get('/me', protect, getMe);
router.get('/users', protect, searchUsers);
router.put('/profile', protect, userValidation.updateProfile, validate, updateProfile);
router.put('/change-password', protect, changePassword);

module.exports = router;