const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        minlength: [2, 'Name must be at least 2 characters'],
        maxlength: [50, 'Name cannot exceed 50 characters']
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    phone: {
        type: String,
        required: false,
        unique: true,
        sparse: true,
        validate: {
            validator: function(v) {
                if (!v) return true;
                // Accept any international phone number
                return /^\+?\d{7,15}$/.test(v.replace(/[\s\-\(\)]/g, ''));
            },
            message: 'Please enter a valid phone number (7-15 digits)'
        }
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: [6, 'Password must be at least 6 characters'],
        select: false
    },
    role: {
        type: String,
        enum: ['user', 'instructor', 'freelancer', 'admin'],
        default: 'user'
    },
    status: {
        type: String,
        enum: ['pending', 'active', 'suspended', 'rejected'],
        default: 'pending'
    },
    country: {
        type: String,
        default: 'ET',
        uppercase: true
    },
    walletBalance: {
        type: Number,
        default: 0,
        min: 0
    },
    profilePicture: {
        type: String,
        default: null
    },
    bio: {
        type: String,
        maxlength: [500, 'Bio cannot exceed 500 characters']
    },
    skills: [{
        type: String,
        trim: true
    }],
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    totalReviews: {
        type: Number,
        default: 0
    },
    completedJobs: {
        type: Number,
        default: 0
    },
    referralCode: {
        type: String,
        unique: true,
        sparse: true
    },
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    lastLogin: {
        type: Date,
        default: null
    },
    resetCode: {
        type: String,
        select: false
    },
    resetCodeExpires: {
        type: Date,
        select: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Update updatedAt on save
userSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

// Compare password method
userSchema.methods.comparePassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Generate referral code
userSchema.pre('save', async function(next) {
    if (!this.referralCode && this.isNew) {
        this.referralCode = this._id.toString().slice(-8) + '_' + Math.random().toString(36).substr(2, 6);
    }
    next();
});

// Virtual for courses (instructor)
userSchema.virtual('courses', {
    ref: 'Course',
    localField: '_id',
    foreignField: 'instructorId'
});

// Virtual for freelancer profile
userSchema.virtual('freelancerProfile', {
    ref: 'Freelancer',
    localField: '_id',
    foreignField: 'userId',
    justOne: true
});

module.exports = mongoose.model('User', userSchema);