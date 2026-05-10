const { body, validationResult } = require('express-validator');

const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array()
        });
    }
    next();
};

// User validation rules
const userValidation = {
    register: [
        body('name').notEmpty().withMessage('Name is required').isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
        body('email').isEmail().withMessage('Please enter a valid email'),
        body('phone').notEmpty().withMessage('Phone number is required'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('role').isIn(['user', 'instructor', 'freelancer', 'admin']).withMessage('Invalid role')
    ],
    login: [
        body('email').isEmail().withMessage('Please enter a valid email'),
        body('password').notEmpty().withMessage('Password is required')
    ],
    updateProfile: [
        body('name').optional().isLength({ min: 2 }),
        body('bio').optional().isLength({ max: 500 }),
        body('skills').optional().isArray(),
        body('phone').optional().notEmpty(),
        body('country').optional().isLength({ min: 2, max: 3 })
    ]
};

// Course validation rules
const courseValidation = {
    create: [
        body('title').notEmpty().withMessage('Title is required').isLength({ min: 5 }),
        body('description').notEmpty().withMessage('Description is required').isLength({ min: 20 }),
        body('price').isNumeric().withMessage('Price must be a number').isFloat({ min: 0 }),
        body('category').notEmpty().withMessage('Category is required')
    ],
    update: [
        body('title').optional().isLength({ min: 5 }),
        body('price').optional().isNumeric().isFloat({ min: 0 })
    ]
};

// Freelancer validation
const freelancerValidation = {
    create: [
        body('title').notEmpty().withMessage('Professional title is required'),
        body('skills').isArray().withMessage('Skills must be an array'),
        body('hourlyRate').isNumeric().withMessage('Hourly rate must be a number').isFloat({ min: 50 })
    ]
};

module.exports = {
    validate,
    userValidation,
    courseValidation,
    freelancerValidation
};