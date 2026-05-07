const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
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
        const Course = require('../models/Course');
        const courses = await Course.find({ 'students.userId': req.user._id })
            .select('title description price category instructorName thumbnail status students');
        const withProgress = courses.map(c => {
            const enrollment = c.students.find(s => s.userId.toString() === req.user._id.toString());
            return {
                _id: c._id,
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

router.get('/:id', getCourseById);
router.put('/:id', protect, updateCourse);
router.delete('/:id', protect, deleteCourse);
router.post('/:id/purchase', protect, purchaseCourse);
router.post('/:id/review', protect, addReview);

module.exports = router;
