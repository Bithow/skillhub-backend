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
        body('username').optional({ checkFalsy: true }).matches(/^[a-zA-Z0-9._-]{3,30}$/).withMessage('Username must be 3-30 characters and use letters, numbers, dots, underscores, or hyphens'),
        body('phone').optional({ nullable: true, checkFalsy: true }),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('role').optional().isIn(['user', 'instructor', 'freelancer', 'client']).withMessage('Invalid role')
    ],
    login: [
        body('identifier').optional({ checkFalsy: true }).isString().trim(),
        body('email').optional({ checkFalsy: true }).isEmail().withMessage('Please enter a valid email'),
        body('username').optional({ checkFalsy: true }).isString().trim(),
        body().custom((_, { req }) => Boolean(req.body.identifier || req.body.email || req.body.username)).withMessage('Email or username is required'),
        body('password').notEmpty().withMessage('Password is required')
    ],
    forgotPassword: [
        body('email').optional({ checkFalsy: true }).isEmail().withMessage('Please enter a valid email'),
        body('phone').optional({ checkFalsy: true }).isString().trim(),
        body().custom((_, { req }) => Boolean(req.body.email || req.body.phone)).withMessage('Email or phone is required')
    ],
    resetPassword: [
        body('email').optional({ checkFalsy: true }).isEmail().withMessage('Please enter a valid email'),
        body('phone').optional({ checkFalsy: true }).isString().trim(),
        body().custom((_, { req }) => Boolean(req.body.email || req.body.phone)).withMessage('Email or phone is required'),
        body('code').matches(/^\d{6}$/).withMessage('Reset code must be six digits'),
        body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
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
        body('hourlyRate').custom(value => Number.isFinite(Number(value)) && Number(value) >= 0)
            .withMessage('Hourly rate must be a nonnegative finite number')
    ]
};

module.exports = {
    validate,
    userValidation,
    courseValidation,
    freelancerValidation
};