const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['course_purchase', 'freelance_hire', 'commission', 'withdrawal', 'deposit', 'referral_bonus', 'refund'],
        required: true
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    commission: {
        type: Number,
        default: 0
    },
    netAmount: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
        enum: ['telebirr', 'cbe_birr', 'chapa', 'whatsapp', 'bank_transfer', 'wallet'],
        required: true
    },
    reference: {
        type: String,
        unique: true,
        sparse: true
    },
    description: String,
    metadata: {
        courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
        freelancerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Freelancer' },
        projectId: { type: mongoose.Schema.Types.ObjectId },
        whatsappMessageId: String
    },
    completedAt: {
        type: Date,
        default: null
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Generate reference number
transactionSchema.pre('save', function(next) {
    if (!this.reference) {
        this.reference = 'TXN_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6).toUpperCase();
    }
    next();
});

module.exports = mongoose.model('Transaction', transactionSchema);