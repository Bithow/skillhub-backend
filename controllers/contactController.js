const prisma = require('../utils/prisma');

const createContactMessage = async (req, res) => {
    try {
        const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
        const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
        const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : '';
        const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';

        if (!name || name.length > 100) return res.status(400).json({ success: false, message: 'Name must contain 1-100 characters' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
            return res.status(400).json({ success: false, message: 'A valid email address is required' });
        }
        if (phone.length > 30) return res.status(400).json({ success: false, message: 'Phone number is too long' });
        if (!['course', 'instructor', 'freelancer', 'project', 'business', 'support', 'report', 'complaint', 'other'].includes(subject)) {
            return res.status(400).json({ success: false, message: 'Select a valid contact subject' });
        }
        if (!message || message.length > 5000) return res.status(400).json({ success: false, message: 'Message must contain 1-5000 characters' });

        const saved = await prisma.contactMessage.create({
            data: { name, email, phone: phone || null, subject, message }
        });
        res.status(201).json({ success: true, message: 'Contact message submitted', id: saved.id });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getContactMessages = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const [messages, total] = await prisma.$transaction([
            prisma.contactMessage.findMany({
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: (page - 1) * limit
            }),
            prisma.contactMessage.count()
        ]);
        res.json({
            success: true,
            messages: messages.map(({ id, ...message }) => ({ ...message, _id: id, id })),
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { createContactMessage, getContactMessages };
