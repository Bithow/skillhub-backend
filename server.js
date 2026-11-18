const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const connectDB = require('./config/database');
const prisma = require('./utils/prisma');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const courseRoutes = require('./routes/courseRoutes');
const freelancerRoutes = require('./routes/freelancerRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const chatRoutes = require('./routes/chatRoutes');
const userRoutes = require('./routes/userRoutes');
const contactRoutes = require('./routes/contactRoutes');
const { startAiStudioWorker } = require('./services/aiStudioWorker');
const analyticsRoutes = require('./routes/analyticsRoutes');

// Initialize app
const app = express();

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
    'https://remarkable-semolina-273e83.netlify.app',
    'https://skillhub-platform.netlify.app'
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || origin === 'null' || allowedOrigins.includes(origin) || /^http:\/\/192\.168\.\d+\.\d+/.test(origin) || /\.netlify\.app$/.test(origin) || /\.vercel\.app$/.test(origin)) {
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
app.use('/api/chat', chatRoutes);
app.use('/api/users', userRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/analytics', analyticsRoutes);

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
        const [totalUsers, totalCourses, totalFreelancers, totalInstructors] = await Promise.all([
            prisma.user.count({ where: { role: 'user', status: 'active' } }),
            prisma.course.count({ where: { status: 'published' } }),
            prisma.freelancer.count({ where: { status: 'approved' } }),
            prisma.user.count({ where: { role: 'instructor', status: 'active' } })
        ]);
        res.json({ success: true, stats: { totalUsers, totalCourses, totalFreelancers, totalInstructors } });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Could not load platform statistics.' });
    }
});

// One-time admin seed endpoint — protected by SEED_ADMIN_TOKEN env var
app.post('/setup/seed-admin', async (req, res) => {
    try {
        const token = req.headers['x-seed-token'];
        const seedToken = process.env.SEED_ADMIN_TOKEN;
        if (!seedToken || token !== seedToken) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }
        const email = process.env.SEED_ADMIN_EMAIL;
        const password = process.env.SEED_ADMIN_PASSWORD;
        if (!email || !password || password.length < 12) {
            return res.status(400).json({ success: false, message: 'SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 12 chars) must be set' });
        }
        const bcrypt = require('bcryptjs');
        const normalizedEmail = email.trim().toLowerCase();
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        const hashedPassword = await bcrypt.hash(password, 10);
        const admin = existing
            ? await prisma.user.update({
                where: { id: existing.id },
                data: { role: 'admin', status: 'active', password: hashedPassword }
            })
            : await prisma.user.create({
                data: {
                    name: 'SkillHub Admin',
                    email: normalizedEmail,
                    password: hashedPassword,
                    role: 'admin',
                    status: 'active',
                    referralCode: `ADMIN_${Date.now()}`
                }
            });
        res.json({ success: true, message: `Admin account ready for ${admin.email}` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Error handling
app.use(notFound);
app.use(errorHandler);

const startServer = async () => {
    if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'production') {
        console.warn('Warning: NODE_ENV is not set to "production". Stack traces will be exposed in error responses.');
    }
    await connectDB();
    await startAiStudioWorker();
    const PORT = process.env.PORT || 5000;
    return app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
};

if (require.main === module) {
    startServer().catch(error => {
        console.error(`Database startup failed: ${error.message}`);
        process.exit(1);
    });
}

module.exports = { app, startServer };