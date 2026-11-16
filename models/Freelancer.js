const mongoose = require('mongoose');

const freelancerSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    title: {
        type: String,
        required: [true, 'Professional title is required'],
        maxlength: [100, 'Title cannot exceed 100 characters']
    },
    skills: [{
        type: String,
        required: true,
        trim: true
    }],
    experience: {
        type: String,
        enum: ['entry', 'junior', 'intermediate', 'senior', 'expert'],
        default: 'junior'
    },
    yearsOfExperience: {
        type: Number,
        min: 0,
        max: 50
    },
    hourlyRate: {
        type: Number,
        required: [true, 'Hourly rate is required'],
        min: [1, 'Hourly rate must be at least $1.00 USD']
    },
    portfolio: [{
        title: String,
        description: String,
        imageUrl: String,
        projectUrl: String,
        createdAt: { type: Date, default: Date.now }
    }],
    availability: {
        type: String,
        enum: ['available', 'busy', 'not_available', 'looking'],
        default: 'available'
    },
    preferredProjects: [{
        type: String,
        trim: true
    }],
    languages: [{
        name: String,
        proficiency: { type: String, enum: ['basic', 'conversational', 'fluent', 'native'] }
    }],
    education: [{
        degree: String,
        institution: String,
        year: Number,
        description: String
    }],
    certifications: [{
        name: String,
        issuer: String,
        year: Number,
        credentialId: String
    }],
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'featured'],
        default: 'pending'
    },
    verificationStatus: {
        type: String,
        enum: ['unverified', 'pending', 'verified'],
        default: 'unverified'
    },
    totalJobs: {
        type: Number,
        default: 0
    },
    completedJobs: {
        type: Number,
        default: 0
    },
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    responseTime: {
        type: Number,
        description: 'Average response time in hours',
        default: 24
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    isFeatured: {
        type: Boolean,
        default: false
    },
    featuredUntil: {
        type: Date,
        default: null
    },
    views: {
        type: Number,
        default: 0
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
    timestamps: true
});

// Index for search
freelancerSchema.index({ skills: 'text', title: 'text' });

module.exports = mongoose.model('Freelancer', freelancerSchema);