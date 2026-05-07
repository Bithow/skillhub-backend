const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');
const Course = require('../models/Course');
const Freelancer = require('../models/Freelancer');

const connectDB = require('../config/database');

const seedData = async () => {
    try {
        await connectDB();
        
        // Clear existing data
        await User.deleteMany();
        await Course.deleteMany();
        await Freelancer.deleteMany();
        
        console.log('🗑️  Cleared existing data');
        
        // Create admin user
        const adminPassword = await bcrypt.hash('Admin123456', 10);
        const admin = await User.create({
            name: 'SkillHub Admin',
            email: 'admin@skillhub.com',
            phone: '251912345678',
            password: adminPassword,
            role: 'admin',
            status: 'active',
            walletBalance: 0
        });
        console.log('✅ Admin user created');
        
        // Create sample instructor
        const instructorPassword = await bcrypt.hash('Instructor123', 10);
        const instructor = await User.create({
            name: 'Biruk Tesfaye',
            email: 'biruk@skillhub.com',
            phone: '251911223344',
            password: instructorPassword,
            role: 'instructor',
            status: 'active',
            walletBalance: 0,
            bio: 'Full-stack developer with 5+ years experience',
            skills: ['JavaScript', 'React', 'Node.js', 'MongoDB']
        });
        console.log('✅ Instructor created');
        
        // Create sample courses
        const courses = await Course.create([
            {
                title: 'Complete Web Development Bootcamp',
                description: 'Learn HTML, CSS, JavaScript, React, Node.js, and MongoDB. Build real-world projects from scratch.',
                shortDescription: 'Become a full-stack developer in 3 months',
                price: 1499,
                category: 'web_development',
                level: 'beginner',
                duration: 120,
                instructorId: instructor._id,
                instructorName: instructor.name,
                instructorPhone: instructor.phone,
                status: 'published',
                tags: ['web development', 'javascript', 'react', 'nodejs'],
                rating: 4.8,
                reviewCount: 45,
                views: 1250
            },
            {
                title: 'Graphic Design Masterclass',
                description: 'Master Photoshop, Illustrator, and Canva. Create stunning logos, social media graphics, and branding materials.',
                shortDescription: 'Become a professional graphic designer',
                price: 999,
                category: 'design',
                level: 'beginner',
                duration: 60,
                instructorId: instructor._id,
                instructorName: instructor.name,
                instructorPhone: instructor.phone,
                status: 'published',
                tags: ['graphic design', 'photoshop', 'illustrator', 'canva'],
                rating: 4.6,
                reviewCount: 32,
                views: 890
            },
            {
                title: 'Digital Marketing Essentials',
                description: 'SEO, Social Media Marketing, Google Ads, Content Strategy. Grow your business online.',
                shortDescription: 'Master digital marketing from scratch',
                price: 1299,
                category: 'marketing',
                level: 'beginner',
                duration: 80,
                instructorId: instructor._id,
                instructorName: instructor.name,
                instructorPhone: instructor.phone,
                status: 'published',
                tags: ['digital marketing', 'seo', 'social media', 'google ads'],
                rating: 4.7,
                reviewCount: 28,
                views: 1100
            }
        ]);
        console.log(`✅ ${courses.length} courses created`);
        
        // Create sample freelancer
        const freelancerPassword = await bcrypt.hash('Freelancer123', 10);
        const freelancer = await User.create({
            name: 'Helen Girma',
            email: 'helen@skillhub.com',
            phone: '251922334455',
            password: freelancerPassword,
            role: 'freelancer',
            status: 'active',
            walletBalance: 500,
            bio: 'Experienced UI/UX designer and frontend developer',
            skills: ['UI/UX Design', 'Figma', 'React', 'Tailwind']
        });
        
        await Freelancer.create({
            userId: freelancer._id,
            title: 'Senior UI/UX Designer & Frontend Developer',
            skills: ['UI/UX Design', 'Figma', 'Adobe XD', 'React', 'Tailwind CSS', 'HTML/CSS'],
            experience: 'senior',
            yearsOfExperience: 5,
            hourlyRate: 350,
            availability: 'available',
            status: 'approved',
            isVerified: true,
            totalJobs: 28,
            completedJobs: 26,
            rating: 4.9
        });
        console.log('✅ Freelancer created');
        
        console.log('\n📊 Seed Data Complete!');
        console.log('=====================');
        console.log(`Admin Email: admin@skillhub.com`);
        console.log(`Admin Password: Admin123456`);
        console.log(`\nInstructor Email: biruk@skillhub.com`);
        console.log(`Instructor Password: Instructor123`);
        console.log(`\nFreelancer Email: helen@skillhub.com`);
        console.log(`Freelancer Password: Freelancer123`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Seed error:', error);
        process.exit(1);
    }
};

seedData();