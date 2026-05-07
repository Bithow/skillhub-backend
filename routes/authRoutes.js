const express = require('express');
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

router.post('/register', userValidation.register, validate, register);
router.post('/login', userValidation.login, validate, login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', protect, getMe);
router.put('/profile', protect, userValidation.updateProfile, validate, updateProfile);
router.put('/change-password', protect, changePassword);

module.exports = router;