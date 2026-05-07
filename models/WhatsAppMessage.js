const mongoose = require('mongoose');

const whatsappMessageSchema = new mongoose.Schema({
    messageId: {
        type: String,
        unique: true
    },
    from: {
        type: String,
        required: true
    },
    to: {
        type: String,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    type: {
        type: String,
        enum: ['inquiry', 'course_purchase', 'freelance_hire', 'support', 'notification', 'broadcast'],
        default: 'inquiry'
    },
    status: {
        type: String,
        enum: ['sent', 'delivered', 'read', 'failed'],
        default: 'sent'
    },
    relatedId: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'relatedModel'
    },
    relatedModel: {
        type: String,
        enum: ['Course', 'Freelancer', 'User', 'Transaction']
    },
    response: {
        type: String,
        default: null
    },
    respondedAt: Date,
    respondedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Index for faster queries
whatsappMessageSchema.index({ from: 1, createdAt: -1 });
whatsappMessageSchema.index({ status: 1 });

module.exports = mongoose.model('WhatsAppMessage', whatsappMessageSchema);