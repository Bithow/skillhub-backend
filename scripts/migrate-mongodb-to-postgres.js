require('dotenv').config();
const mongoose = require('mongoose');
const prisma = require('../utils/prisma');
const User = require('../models/User');
const Course = require('../models/Course');
const Freelancer = require('../models/Freelancer');
const Transaction = require('../models/Transaction');
const Message = require('../models/Message');
const WhatsAppMessage = require('../models/WhatsAppMessage');

const serialize = value => {
    if (value === null || value === undefined) return value;
    if (value instanceof Date) return value;
    if (value?._bsontype === 'ObjectId' || value?._bsontype === 'ObjectID') return value.toString();
    if (Array.isArray(value)) return value.map(serialize);
    if (typeof value === 'object') {
        const source = typeof value.toObject === 'function' ? value.toObject() : value;
        return Object.fromEntries(Object.entries(source)
            .filter(([, nested]) => nested !== undefined)
            .map(([key, nested]) => [key, serialize(nested)]));
    }
    return value;
};

const chunks = async (model, rows, size = 400) => {
    let imported = 0;
    for (let index = 0; index < rows.length; index += size) {
        const result = await model.createMany({ data: rows.slice(index, index + size), skipDuplicates: true });
        imported += result.count;
    }
    return imported;
};

const run = async () => {
    if (!process.env.MONGODB_URI || !process.env.DATABASE_URL) {
        throw new Error('Set MONGODB_URI and DATABASE_URL in the environment before migration.');
    }
    await mongoose.connect(process.env.MONGODB_URI);
    await prisma.$connect();

    const [mongoUsers, mongoCourses, mongoFreelancers, mongoTransactions, mongoMessages, mongoWhatsAppMessages] = await Promise.all([
        User.find().select('+password +resetCode +resetCodeExpires').lean(),
        Course.find().lean(),
        Freelancer.find().lean(),
        Transaction.find().lean(),
        Message.find().lean(),
        WhatsAppMessage.find().lean()
    ]);
    const userIds = new Set(mongoUsers.map(user => user._id.toString()));
    const courseIds = new Set(mongoCourses.map(course => course._id.toString()));
    const freelancerIds = new Set(mongoFreelancers.map(freelancer => freelancer._id.toString()));

    const users = mongoUsers.map(user => ({
        id: user._id.toString(), name: user.name, email: user.email.toLowerCase(), username: user.username || null,
        phone: user.phone || null, password: user.password, role: user.role, status: user.status,
        country: user.country || 'ET', walletBalance: user.walletBalance || 0, profilePicture: user.profilePicture || null,
        bio: user.bio || null, skills: user.skills || [], rating: user.rating || 0, totalReviews: user.totalReviews || 0,
        completedJobs: user.completedJobs || 0, referralCode: user.referralCode || null,
        referredById: user.referredBy && userIds.has(user.referredBy.toString()) ? user.referredBy.toString() : null,
        lastLogin: user.lastLogin || null, resetCode: user.resetCode || null, resetCodeExpires: user.resetCodeExpires || null,
        createdAt: user.createdAt || new Date(), updatedAt: user.updatedAt || new Date()
    }));
    const importedUsers = await chunks(prisma.user, users);

    const courses = mongoCourses.filter(course => userIds.has(course.instructorId.toString())).map(course => ({
        id: course._id.toString(), title: course.title, description: course.description,
        shortDescription: course.shortDescription || null, price: course.price, category: course.category,
        subcategory: course.subcategory || null, level: course.level || 'beginner', duration: course.duration || null,
        lessons: serialize(course.lessons || []), instructorId: course.instructorId.toString(),
        instructorName: course.instructorName || null, instructorPhone: course.instructorPhone || null,
        thumbnail: course.thumbnail || null, promoVideo: course.promoVideo || null, status: course.status || 'pending',
        rejectionReason: course.rejectionReason || null, studentCount: course.students?.length || course.studentCount || 0,
        rating: course.rating || 0, reviewCount: course.reviewCount || 0, reviews: serialize(course.reviews || []),
        tags: course.tags || [], discussion: serialize(course.discussion || []), isFeatured: course.isFeatured || false,
        views: course.views || 0, createdAt: course.createdAt || new Date(), updatedAt: course.updatedAt || new Date()
    }));
    const importedCourses = await chunks(prisma.course, courses);

    const enrollments = [];
    for (const course of mongoCourses) {
        for (const enrollment of course.students || []) {
            const userId = enrollment.userId?.toString();
            if (!courseIds.has(course._id.toString()) || !userIds.has(userId)) continue;
            enrollments.push({
                id: `${course._id.toString()}_${userId}`,
                courseId: course._id.toString(), userId,
                enrolledAt: enrollment.enrolledAt || new Date(), progress: enrollment.progress || 0,
                completed: enrollment.completed || false
            });
        }
    }
    const importedEnrollments = await chunks(prisma.enrollment, enrollments);

    const freelancers = mongoFreelancers.filter(freelancer => userIds.has(freelancer.userId.toString())).map(freelancer => ({
        id: freelancer._id.toString(), userId: freelancer.userId.toString(), title: freelancer.title,
        skills: freelancer.skills || [], experience: freelancer.experience || 'junior',
        yearsOfExperience: freelancer.yearsOfExperience ?? null, hourlyRate: freelancer.hourlyRate,
        portfolio: serialize(freelancer.portfolio || []), availability: freelancer.availability || 'available',
        preferredProjects: freelancer.preferredProjects || [], languages: serialize(freelancer.languages || []),
        education: serialize(freelancer.education || []), certifications: serialize(freelancer.certifications || []),
        status: freelancer.status || 'pending', verificationStatus: freelancer.verificationStatus || 'unverified',
        totalJobs: freelancer.totalJobs || 0, completedJobs: freelancer.completedJobs || 0, rating: freelancer.rating || 0,
        responseTime: freelancer.responseTime || 24, isVerified: freelancer.isVerified || false,
        isFeatured: freelancer.isFeatured || false, featuredUntil: freelancer.featuredUntil || null,
        views: freelancer.views || 0, createdAt: freelancer.createdAt || new Date(), updatedAt: freelancer.updatedAt || new Date()
    }));
    const importedFreelancers = await chunks(prisma.freelancer, freelancers);

    const transactions = mongoTransactions.filter(transaction => userIds.has(transaction.userId.toString())).map(transaction => {
        const metadata = serialize(transaction.metadata || {});
        const courseId = metadata.courseId && courseIds.has(metadata.courseId) ? metadata.courseId : null;
        const freelancerId = metadata.freelancerId && freelancerIds.has(metadata.freelancerId) ? metadata.freelancerId : null;
        return {
            id: transaction._id.toString(), userId: transaction.userId.toString(), type: transaction.type,
            amount: transaction.amount, commission: transaction.commission || 0, netAmount: transaction.netAmount,
            status: transaction.status || 'pending', paymentMethod: transaction.paymentMethod,
            reference: transaction.reference || `MIG_${transaction._id}`, description: transaction.description || null,
            metadata, courseId, freelancerId, completedAt: transaction.completedAt || null,
            createdAt: transaction.createdAt || new Date(), updatedAt: transaction.updatedAt || new Date()
        };
    });
    const importedTransactions = await chunks(prisma.transaction, transactions);

    const messages = mongoMessages.filter(message => userIds.has(message.senderId.toString()) && userIds.has(message.receiverId.toString())).map(message => ({
        id: message._id.toString(), conversationId: message.conversationId,
        senderId: message.senderId.toString(), receiverId: message.receiverId.toString(),
        content: message.content, type: message.type || 'text', fileUrl: message.fileUrl || null,
        fileName: message.fileName || null, read: message.read || false, readAt: message.readAt || null,
        deletedBySender: message.deletedBySender || false, deletedByReceiver: message.deletedByReceiver || false,
        createdAt: message.createdAt || new Date(), updatedAt: message.updatedAt || new Date()
    }));
    const importedMessages = await chunks(prisma.message, messages);

    const whatsappMessages = mongoWhatsAppMessages.map(message => ({
        id: message._id.toString(), messageId: message.messageId || null,
        from: message.from, to: message.to, message: message.message,
        type: message.type || 'inquiry', status: message.status || 'sent',
        relatedId: message.relatedId ? message.relatedId.toString() : null,
        relatedModel: message.relatedModel || null, response: message.response || null,
        respondedAt: message.respondedAt || null,
        respondedById: message.respondedBy && userIds.has(message.respondedBy.toString()) ? message.respondedBy.toString() : null,
        createdAt: message.createdAt || new Date(), updatedAt: message.updatedAt || new Date()
    }));
    const importedWhatsAppMessages = await chunks(prisma.whatsAppMessage, whatsappMessages);

    console.log(JSON.stringify({
        sourceCounts: { users: users.length, courses: courses.length, enrollments: enrollments.length, freelancers: freelancers.length, transactions: transactions.length, messages: messages.length, whatsappMessages: whatsappMessages.length },
        importedCounts: { users: importedUsers, courses: importedCourses, enrollments: importedEnrollments, freelancers: importedFreelancers, transactions: importedTransactions, messages: importedMessages, whatsappMessages: importedWhatsAppMessages }
    }, null, 2));
};

run()
    .catch(error => {
        console.error(`MongoDB to PostgreSQL migration failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        await mongoose.disconnect();
    });
