const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Course title is required'],
        trim: true,
        minlength: [5, 'Title must be at least 5 characters'],
        maxlength: [100, 'Title cannot exceed 100 characters']
    },
    description: {
        type: String,
        required: [true, 'Course description is required'],
        minlength: [20, 'Description must be at least 20 characters'],
        maxlength: [5000, 'Description cannot exceed 5000 characters']
    },
    shortDescription: {
        type: String,
        maxlength: [200, 'Short description cannot exceed 200 characters']
    },
    price: {
        type: Number,
        required: [true, 'Price is required'],
        min: [0, 'Price cannot be negative'],
        max: [50000, 'Price cannot exceed 50,000 ETB']
    },
    category: {
        type: String,
        required: [true, 'Category is required'],
        enum: ['web_development', 'mobile_development', 'data_science', 'design', 'marketing', 'business', 'language', 'other']
    },
    subcategory: String,
    level: {
        type: String,
        enum: ['beginner', 'intermediate', 'advanced', 'all_levels'],
        default: 'beginner'
    },
    duration: {
        type: Number,
        description: 'Duration in hours'
    },
    lessons: [{
        title: String,
        description: String,
        videoUrl: String,
        duration: Number,
        order: Number
    }],
    instructorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    instructorName: String,
    instructorPhone: String,
    thumbnail: {
        type: String,
        default: null
    },
    promoVideo: String,
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'published', 'draft'],
        default: 'pending'
    },
    rejectionReason: String,
    students: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        enrolledAt: { type: Date, default: Date.now },
        progress: { type: Number, default: 0 },
        completed: { type: Boolean, default: false }
    }],
    studentCount: {
        type: Number,
        default: 0
    },
    rating: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    reviewCount: {
        type: Number,
        default: 0
    },
    reviews: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        userName: String,
        rating: { type: Number, min: 1, max: 5 },
        comment: String,
        createdAt: { type: Date, default: Date.now }
    }],
    tags: [String],
    isFeatured: {
        type: Boolean,
        default: false
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
    timestamps: true,
    toJSON: { virtuals: true }
});

// Update student count
courseSchema.pre('save', function(next) {
    this.studentCount = this.students.length;
    this.updatedAt = Date.now();
    next();
});

// Calculate average rating
courseSchema.methods.calculateRating = function() {
    if (this.reviews.length === 0) {
        this.rating = 0;
        return;
    }
    const sum = this.reviews.reduce((acc, review) => acc + review.rating, 0);
    this.rating = sum / this.reviews.length;
    this.reviewCount = this.reviews.length;
};

// Index for search
courseSchema.index({ title: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Course', courseSchema);