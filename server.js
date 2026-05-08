const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const connectDB = require('./config/database');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const courseRoutes = require('./routes/courseRoutes');
const freelancerRoutes = require('./routes/freelancerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');

// Initialize app
const app = express();

// Connect to MongoDB
connectDB();

// Security middleware
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS — allow frontend served via Live Server, localhost, or opened as a file
const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://127.0.0.1:3000',
    'http://192.168.137.1:5500',
    'https://remarkable-semolina-273e83.netlify.app'
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || origin === 'null' || allowedOrigins.includes(origin) || /^http:\/\/192\.168\.\d+\.\d+/.test(origin) || /\.netlify\.app$/.test(origin)) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: origin ${origin} not allowed`));
        }
    },
    credentials: true
}));

// Static files (for uploaded images)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/freelancers', freelancerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Root route
app.get('/', (req, res) => {
    res.json({
        name: 'SkillHub API',
        version: '1.0.0',
        description: 'Backend API for SkillHub - Course & Freelance Marketplace',
        endpoints: {
            auth: '/api/auth',
            courses: '/api/courses',
            freelancers: '/api/freelancers',
            admin: '/api/admin',
            payments: '/api/payments',
            whatsapp: '/api/whatsapp'
        }
    });
});

// Public stats endpoint (no auth required)
app.get('/api/stats', async (req, res) => {
    try {
        const mongoose = require('mongoose');
        const User = require('./models/User');
        const Course = require('./models/Course');
        const Freelancer = require('./models/Freelancer');
        const [totalUsers, totalCourses, totalFreelancers] = await Promise.all([
            User.countDocuments({ status: 'active' }),
            Course.countDocuments({ status: 'published' }),
            Freelancer.countDocuments({ status: 'approved' })
        ]);
        res.json({ success: true, stats: { totalUsers, totalCourses, totalFreelancers } });
    } catch (e) {
        res.json({ success: false, stats: { totalUsers: 1000, totalCourses: 500, totalFreelancers: 100 } });
    }
});

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 Local: http://localhost:${PORT}`);
    console.log(`🌐 Network: http://192.168.137.1:${PORT}`);
    console.log(`📱 Phone Access: Open http://192.168.137.1:5500 on your phone`);
});