const prisma = require('../utils/prisma');
const WhatsAppService = require('../utils/whatsappService');
const { getCommissionSettings } = require('../utils/commission');

const mapRelation = value => {
    if (!value) return value;
    if (Array.isArray(value)) return value.map(mapRelation);
    if (typeof value !== 'object' || value instanceof Date) return value;
    const { id, ...fields } = value;
    const mapped = { ...fields, _id: id, id };
    for (const [key, nested] of Object.entries(mapped)) {
        const apiKey = key === 'instructor' ? 'instructorId' : key;
        if (apiKey !== key) delete mapped[key];
        mapped[apiKey] = nested && typeof nested === 'object' ? mapRelation(nested) : nested;
    }
    return mapped;
};

const courseInclude = { instructor: { select: { id: true, name: true, rating: true, totalReviews: true } } };
const toPage = value => Math.max(1, Number.parseInt(value, 10) || 1);
const toLimit = value => Math.min(100, Math.max(1, Number.parseInt(value, 10) || 20));

const createCourse = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user || user.role !== 'instructor' || user.status !== 'active') {
            return res.status(403).json({ success: false, message: 'Only approved instructors can create courses' });
        }

        const { title, description, price, category, level, duration, tags, thumbnail } = req.body;
        const course = await prisma.course.create({
            data: {
                title,
                description,
                price: Number(price),
                category,
                level,
                duration: duration === undefined ? null : Number(duration),
                thumbnail: thumbnail || null,
                tags: tags || [],
                instructorId: user.id,
                instructorName: user.name,
                instructorPhone: user.phone,
                status: 'pending'
            },
            include: courseInclude
        });
        await WhatsAppService.sendToAdmin(
            `New Course Pending Approval\nTitle: ${title}\nInstructor: ${user.name}\nPrice: $${Number(price).toFixed(2)} USD`
        );
        res.status(201).json({ success: true, course: mapRelation(course) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getCourses = async (req, res) => {
    try {
        const { page: pageQuery, limit: limitQuery, category, level, minPrice, maxPrice, search, instructor, featured, sort = '-createdAt' } = req.query;
        const page = toPage(pageQuery);
        const limit = toLimit(limitQuery);
        const where = { status: 'published' };
        const categoryAliases = {
            technology: ['web_development', 'mobile_development', 'data_science'],
            business: ['business'],
            design: ['design'],
            marketing: ['marketing'],
            entrepreneurship: ['other']
        };
        if (category) {
            const categoryKey = String(category).trim().toLowerCase();
            where.category = { in: categoryAliases[categoryKey] || [category] };
        }
        if (level && ['beginner', 'intermediate', 'advanced', 'all_levels'].includes(String(level))) {
            where.level = String(level);
        }
        if (featured === 'true') where.isFeatured = true;
        if (minPrice || maxPrice) {
            where.price = {};
            if (minPrice && Number.isFinite(Number(minPrice))) where.price.gte = Number(minPrice);
            if (maxPrice && Number.isFinite(Number(maxPrice))) where.price.lte = Number(maxPrice);
        }
        if (search) {
            const searchKeywords = String(search).trim().split(/\s+/).filter(keyword => keyword.length > 2);
            const searchCategory = String(search).trim().toLowerCase();
            const categorySearchAliases = {
                technology: ['web_development', 'mobile_development', 'data_science'],
                business: ['business'],
                design: ['design'],
                marketing: ['marketing'],
                entrepreneurship: ['other']
            };
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { description: { contains: search, mode: 'insensitive' } },
                { instructorName: { contains: search, mode: 'insensitive' } },
                { category: { contains: search, mode: 'insensitive' } },
                ...(searchKeywords.length ? [{ tags: { hasSome: searchKeywords } }] : []),
                ...(categorySearchAliases[searchCategory] ? [{ category: { in: categorySearchAliases[searchCategory] } }] : [])
            ];
        }
        if (instructor) where.instructorName = { contains: String(instructor), mode: 'insensitive' };
        const sortField = String(sort).replace(/^-/, '');
        const sortOrder = String(sort).startsWith('-') ? 'desc' : 'asc';
        if (sortField === 'trending') {
            const searchConditions = where.OR ? [{ OR: where.OR }] : [];
            delete where.OR;
            where.AND = searchConditions.concat({
                OR: [
                    { views: { gt: 0 } },
                    { studentCount: { gt: 0 } }
                ]
            });
        }
        const orderBy = sortField === 'trending'
            ? [{ views: 'desc' }, { studentCount: 'desc' }, { createdAt: 'desc' }]
            : ['title', 'price', 'createdAt', 'rating', 'studentCount', 'views'].includes(sortField)
                ? { [sortField]: sortOrder }
                : { createdAt: 'desc' };
        const [courses, total] = await prisma.$transaction([
            prisma.course.findMany({
                where,
                include: courseInclude,
                omit: { instructorPhone: true, lessons: true },
                orderBy,
                take: limit,
                skip: (page - 1) * limit
            }),
            prisma.course.count({ where })
        ]);
        res.json({
            success: true,
            courses: mapRelation(courses),
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getCourseById = async (req, res) => {
    try {
        const course = await prisma.course.findUnique({
            where: { id: req.params.id },
            include: { ...courseInclude, students: true },
            omit: { instructorPhone: true }
        });
        if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

        const isOwnerOrAdmin = req.user && (
            req.user.role === 'admin' || course.instructorId === req.user.id
        );
        if (course.status !== 'published' && !isOwnerOrAdmin) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        const isEnrolled = req.user && course.students.some(student => student.userId === req.user.id);
        if (!isOwnerOrAdmin && !isEnrolled) {
            course.lessons = course.lessons.filter(lesson => lesson.isFree);
        }
        if (!isOwnerOrAdmin) course.students = [];
        await prisma.course.update({ where: { id: course.id }, data: { views: { increment: 1 } } });
        course.views += 1;
        res.json({ success: true, course: mapRelation(course) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateCourse = async (req, res) => {
    try {
        const course = await prisma.course.findUnique({ where: { id: req.params.id } });
        if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
        if (course.instructorId !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized to update this course' });
        }

        const { title, description, price, category, level, duration, tags, thumbnail } = req.body;
        const data = { status: 'pending' };
        if (title !== undefined) data.title = title;
        if (description !== undefined) data.description = description;
        if (price !== undefined) data.price = Number(price);
        if (category !== undefined) data.category = category;
        if (level !== undefined) data.level = level;
        if (duration !== undefined) data.duration = Number(duration);
        if (tags !== undefined) data.tags = tags;
        if (thumbnail !== undefined) data.thumbnail = thumbnail || null;
        const updated = await prisma.course.update({
            where: { id: course.id },
            data,
            include: courseInclude
        });
        res.json({ success: true, course: mapRelation(updated) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteCourse = async (req, res) => {
    try {
        const course = await prisma.course.findUnique({ where: { id: req.params.id } });
        if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
        if (course.instructorId !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Not authorized to delete this course' });
        }
        await prisma.course.delete({ where: { id: course.id } });
        res.json({ success: true, message: 'Course deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const purchaseCourse = async (req, res) => {
    try {
        const course = await prisma.course.findUnique({ where: { id: req.params.id }, include: { students: true } });
        if (!course || course.status !== 'published') {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        if (course.students.some(student => student.userId === req.user.id)) {
            return res.status(400).json({ success: false, message: 'Already enrolled in this course' });
        }
        const rates = await getCommissionSettings(prisma);
        const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
        const commission = money(course.price * rates.skillhubCommissionPercent / 100);
        const transaction = await prisma.transaction.create({
            data: {
                userId: req.user.id,
                type: 'course_purchase',
                amount: course.price,
                commission,
                netAmount: money(course.price - commission),
                status: 'pending',
                paymentMethod: 'whatsapp',
                reference: `TXN_${Date.now()}_${require('crypto').randomBytes(3).toString('hex').toUpperCase()}`,
                courseId: course.id,
                metadata: { courseId: course.id, commissionRates: rates }
            }
        });
        await WhatsAppService.sendToNumber(
            req.user.phone,
            `Course Purchase: ${course.title}\nAmount: $${Number(course.price).toFixed(2)} USD\nReference: ${transaction.reference}\n\nComplete your payment using the listed payment method, then reply with PAID ${transaction.reference}`
        );
        res.json({
            success: true,
            message: 'Payment instruction sent to your WhatsApp',
            transaction: { reference: transaction.reference, amount: course.price, courseTitle: course.title }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const addReview = async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const result = await prisma.$transaction(async tx => {
            const course = await tx.course.findUnique({
                where: { id: req.params.id },
                include: { students: { where: { userId: req.user.id } } }
            });
            if (!course) return { status: 404, message: 'Course not found' };
            if (!course.students.length) return { status: 403, message: 'You must be enrolled to review this course' };
            const reviews = Array.isArray(course.reviews) ? course.reviews : [];
            if (reviews.some(review => review.userId === req.user.id)) {
                return { status: 400, message: 'You have already reviewed this course' };
            }
            const nextReviews = [...reviews, {
                userId: req.user.id,
                userName: req.user.name,
                rating: Number(rating),
                comment: comment || '',
                createdAt: new Date().toISOString()
            }];
            const average = nextReviews.reduce((sum, review) => sum + review.rating, 0) / nextReviews.length;
            const updated = await tx.course.update({
                where: { id: course.id },
                data: { reviews: nextReviews, rating: average, reviewCount: nextReviews.length }
            });
            return { course: updated };
        });
        if (result.status) return res.status(result.status).json({ success: false, message: result.message });
        res.json({ success: true, message: 'Review added successfully', rating: result.course.rating });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getInstructorCourses = async (req, res) => {
    try {
        const courses = await prisma.course.findMany({
            where: { instructorId: req.params.instructorId, status: 'published' },
            include: courseInclude,
            omit: { instructorPhone: true, lessons: true }
        });
        res.json({ success: true, courses: mapRelation(courses) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCourse,
    getCourses,
    getCourseById,
    updateCourse,
    deleteCourse,
    purchaseCourse,
    addReview,
    getInstructorCourses
};
