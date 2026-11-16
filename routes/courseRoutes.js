const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { protect, optionalProtect } = require('../middleware/auth');
const prisma = require('../utils/prisma');
const {
    createCourse,
    getCourses,
    getCourseById,
    updateCourse,
    deleteCourse,
    purchaseCourse,
    addReview,
    getInstructorCourses
} = require('../controllers/courseController');

router.get('/', getCourses);
router.post('/', protect, createCourse);
router.get('/instructor/:instructorId', getInstructorCourses);

// Get courses the logged-in learner is enrolled in
router.get('/enrolled/me', protect, async (req, res) => {
    try {
        const courses = await prisma.course.findMany({
            where: { students: { some: { userId: req.user.id } } },
            select: {
                id: true,
                title: true,
                description: true,
                price: true,
                category: true,
                instructorName: true,
                thumbnail: true,
                status: true,
                students: { where: { userId: req.user.id } }
            }
        });
        const withProgress = courses.map(c => {
            const enrollment = c.students[0];
            return {
                _id: c.id,
                id: c.id,
                title: c.title,
                description: c.description,
                price: c.price,
                category: c.category,
                instructorName: c.instructorName,
                thumbnail: c.thumbnail,
                progress: enrollment ? enrollment.progress : 0,
                completed: enrollment ? enrollment.completed : false,
                enrolledAt: enrollment ? enrollment.enrolledAt : null
            };
        });
        res.json({ success: true, courses: withProgress });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/:id/enroll', protect, async (req, res) => {
    try {
        const result = await prisma.$transaction(async tx => {
            const course = await tx.course.findFirst({ where: { id: req.params.id, status: 'published' } });
            if (!course) return { status: 404, message: 'Published course not found' };
            if (Number(course.price) > 0) return { status: 402, message: 'Paid courses must use the verified checkout flow' };
            const existing = await tx.enrollment.findUnique({
                where: { courseId_userId: { courseId: course.id, userId: req.user.id } }
            });
            if (existing) return { status: 200, enrollment: existing, alreadyEnrolled: true };
            const enrollment = await tx.enrollment.create({ data: { courseId: course.id, userId: req.user.id } });
            await tx.course.update({ where: { id: course.id }, data: { studentCount: { increment: 1 } } });
            return { status: 201, enrollment };
        });
        if (result.message) return res.status(result.status).json({ success: false, message: result.message });
        res.status(result.status).json({ success: true, alreadyEnrolled: !!result.alreadyEnrolled, enrollment: result.enrollment });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/:id/progress', protect, async (req, res) => {
    try {
        const enrollment = await prisma.enrollment.findUnique({
            where: { courseId_userId: { courseId: req.params.id, userId: req.user.id } },
            include: { course: { select: { lessons: true } } }
        });
        if (!enrollment) {
            return res.status(403).json({ success: false, message: 'Enrollment is required to view course progress' });
        }
        res.json({
            success: true,
            progress: enrollment.progress,
            completed: enrollment.completed,
            completedLessons: enrollment.completedLessons
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/:id/progress', protect, async (req, res) => {
    try {
        const course = await prisma.course.findUnique({ where: { id: req.params.id }, select: { id: true, lessons: true } });
        if (!course) return res.status(404).json({ success: false, message: 'Course not found' });

        const lessonCount = Array.isArray(course.lessons) ? course.lessons.length : 0;
        const requestedLessons = req.body.completedLessons;
        if (!Array.isArray(requestedLessons)
            || requestedLessons.some(index => !Number.isInteger(index) || index < 0 || index >= lessonCount)) {
            return res.status(400).json({ success: false, message: 'completedLessons must contain valid lesson indices' });
        }

        const enrollment = await prisma.enrollment.findUnique({
            where: { courseId_userId: { courseId: course.id, userId: req.user.id } }
        });
        if (!enrollment) {
            return res.status(403).json({ success: false, message: 'Enrollment is required to update course progress' });
        }

        const completedLessons = [...new Set(requestedLessons)].sort((first, second) => first - second);
        const completed = lessonCount > 0 && completedLessons.length === lessonCount;
        const progress = lessonCount > 0 ? Math.round((completedLessons.length / lessonCount) * 100) : 0;
        const updated = await prisma.enrollment.update({
            where: { courseId_userId: { courseId: course.id, userId: req.user.id } },
            data: {
                completedLessons,
                completed,
                progress,
                completedAt: completed ? enrollment.completedAt || new Date() : null
            }
        });
        res.json({
            success: true,
            progress: updated.progress,
            completed: updated.completed,
            completedLessons: updated.completedLessons,
            completedAt: updated.completedAt
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/:id/certificate', protect, async (req, res) => {
    try {
        const enrollment = await prisma.enrollment.findUnique({
            where: { courseId_userId: { courseId: req.params.id, userId: req.user.id } },
            include: {
                course: { select: { id: true, title: true, certificateEligible: true } },
                user: { select: { id: true, name: true } }
            }
        });
        if (!enrollment) {
            return res.status(403).json({ success: false, message: 'Enrollment is required to access a certificate' });
        }
        if (!enrollment.completed || enrollment.progress < 100 || !enrollment.completedAt) {
            return res.status(403).json({ success: false, message: 'You have not completed this course yet' });
        }
        if (!enrollment.course.certificateEligible) {
            return res.status(403).json({ success: false, message: 'This course does not issue a completion certificate' });
        }

        const certificateHash = crypto.createHash('sha256')
            .update(`${enrollment.userId}:${enrollment.courseId}`)
            .digest('hex')
            .slice(0, 12)
            .toUpperCase();
        res.json({
            success: true,
            userName: enrollment.user.name,
            courseTitle: enrollment.course.title,
            completedAt: enrollment.completedAt,
            certificateId: `SKH-${certificateHash}`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/:id', optionalProtect, getCourseById);
router.put('/:id', protect, updateCourse);
router.delete('/:id', protect, deleteCourse);
router.post('/:id/purchase', protect, purchaseCourse);
router.post('/:id/review', protect, addReview);

// Discussion endpoints
router.post('/:id/discussion', protect, async (req, res) => {
    try {
        const course = await prisma.course.findUnique({
            where: { id: req.params.id },
            include: { students: true }
        });
        if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
        const isOwnerOrAdmin = req.user.role === 'admin'
            || course.instructorId === req.user.id;
        const isEnrolled = course.students.some(student => student.userId === req.user.id);
        if (course.status !== 'published' && !isOwnerOrAdmin) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        if (!isOwnerOrAdmin && !isEnrolled) {
            return res.status(403).json({ success: false, message: 'Enrollment is required to join the discussion' });
        }
        if (typeof req.body.message !== 'string' || !req.body.message.trim() || req.body.message.length > 2000) {
            return res.status(400).json({ success: false, message: 'Message must contain 1-2000 characters' });
        }
        const discussion = Array.isArray(course.discussion) ? course.discussion : [];
        discussion.push({
            userId: req.user.id,
            userName: req.user.name,
            message: req.body.message.trim(),
            createdAt: new Date().toISOString()
        });
        const updated = await prisma.course.update({
            where: { id: course.id },
            data: { discussion }
        });
        res.json({ success: true, discussion: updated.discussion });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/:id/discussion', protect, async (req, res) => {
    try {
        const course = await prisma.course.findUnique({
            where: { id: req.params.id },
            select: { id: true, discussion: true, title: true, instructorId: true, status: true, students: true }
        });
        if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
        const isOwnerOrAdmin = req.user.role === 'admin'
            || course.instructorId === req.user.id;
        const isEnrolled = course.students.some(student => student.userId === req.user.id);
        if (course.status !== 'published' && !isOwnerOrAdmin) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        if (!isOwnerOrAdmin && !isEnrolled) {
            return res.status(403).json({ success: false, message: 'Enrollment is required to view the discussion' });
        }
        res.json({ success: true, discussion: course.discussion });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
