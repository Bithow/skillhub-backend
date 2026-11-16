const express = require('express');
const { protect } = require('../middleware/auth');
const { searchUsers } = require('../controllers/chatController');
const prisma = require('../utils/prisma');

const router = express.Router();
router.get('/search', protect, searchUsers);

router.get('/platform-search', async (req, res) => {
	try {
		const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
		if (query.length < 2) return res.json({ success: true, query, courses: [], freelancers: [] });
		if (query.length > 100) return res.status(400).json({ success: false, message: 'Search query is too long' });

		const [courses, freelancers] = await prisma.$transaction([
			prisma.course.findMany({
				where: {
					status: 'published',
					OR: [
						{ title: { contains: query, mode: 'insensitive' } },
						{ description: { contains: query, mode: 'insensitive' } },
						...query.split(/\s+/).filter(Boolean).map(term => ({ tags: { has: term } }))
					]
				},
				select: {
					id: true,
					title: true,
					shortDescription: true,
					description: true,
					category: true,
					price: true,
					thumbnail: true,
					instructorName: true
				},
				orderBy: [{ studentCount: 'desc' }, { createdAt: 'desc' }],
				take: 8
			}),
			prisma.freelancer.findMany({
				where: {
					status: 'approved',
					user: { is: { status: 'active' } },
					OR: [
						{ title: { contains: query, mode: 'insensitive' } },
						{ skills: { has: query } },
						...query.split(/\s+/).filter(Boolean).map(term => ({ skills: { has: term } })),
						{ user: { is: { name: { contains: query, mode: 'insensitive' } } } }
					]
				},
				select: {
					id: true,
					title: true,
					skills: true,
					hourlyRate: true,
					rating: true,
					availability: true,
					user: { select: { id: true, name: true, profilePicture: true } }
				},
				orderBy: [{ rating: 'desc' }, { createdAt: 'desc' }],
				take: 8
			})
		]);

		res.json({
			success: true,
			query,
			courses: courses.map(course => ({ ...course, _id: course.id })),
			freelancers: freelancers.map(({ user, ...freelancer }) => ({
				...freelancer,
				_id: freelancer.id,
				userId: { ...user, _id: user.id }
			}))
		});
	} catch (error) {
		res.status(500).json({ success: false, message: error.message });
	}
});

module.exports = router;
