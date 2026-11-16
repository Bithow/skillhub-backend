const prisma = require('../utils/prisma');
const WhatsAppService = require('../utils/whatsappService');

const mapRelation = value => {
    if (!value) return value;
    if (Array.isArray(value)) return value.map(mapRelation);
    if (typeof value !== 'object' || value instanceof Date) return value;
    const { id, ...fields } = value;
    const mapped = { ...fields, _id: id, id };
    for (const [key, nested] of Object.entries(mapped)) {
        const apiKey = key === 'user' ? 'userId' : key;
        if (apiKey !== key) delete mapped[key];
        mapped[apiKey] = nested && typeof nested === 'object' ? mapRelation(nested) : nested;
    }
    return mapped;
};

const createFreelancerProfile = async (req, res) => {
    try {
        const { title, skills, hourlyRate, experience, portfolio, availability } = req.body;
        const parsedHourlyRate = Number(hourlyRate);
        if (hourlyRate === undefined || !Number.isFinite(parsedHourlyRate) || parsedHourlyRate < 0) {
            return res.status(400).json({ success: false, message: 'Hourly rate must be a nonnegative number.' });
        }
        const freelancer = await prisma.$transaction(async tx => {
            const existing = await tx.freelancer.findUnique({ where: { userId: req.user.id } });
            if (existing) return { conflict: true };
            const created = await tx.freelancer.create({
                data: {
                    userId: req.user.id,
                    title,
                    skills,
                    hourlyRate: parsedHourlyRate,
                    experience,
                    portfolio: portfolio || [],
                    availability: availability || 'available',
                    status: 'pending'
                },
                include: { user: { select: { id: true, name: true } } }
            });
            if (req.user.role !== 'freelancer') {
                await tx.user.update({ where: { id: req.user.id }, data: { role: 'freelancer', status: 'pending' } });
            }
            return created;
        });
        if (freelancer.conflict) {
            return res.status(400).json({ success: false, message: 'You already have a freelancer profile' });
        }
        await WhatsAppService.sendToAdmin(
            `New Freelancer Registration\nName: ${req.user.name}\nSkills: ${skills.join(', ')}\nRate: $${Number(hourlyRate).toFixed(2)} USD/hr`
        );
        res.status(201).json({ success: true, freelancer: mapRelation(freelancer) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getFreelancers = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
        const { skill, minRate, maxRate, search } = req.query;
        const where = { status: 'approved', user: { is: { status: 'active' } } };
        if (skill) where.skills = { has: skill };
        if (minRate || maxRate) {
            where.hourlyRate = {};
            if (minRate && Number.isFinite(Number(minRate))) where.hourlyRate.gte = Number(minRate);
            if (maxRate && Number.isFinite(Number(maxRate))) where.hourlyRate.lte = Number(maxRate);
        }
        if (search) {
            where.OR = [
                { title: { contains: search, mode: 'insensitive' } },
                { skills: { has: search } }
            ];
        }
        const [freelancers, total] = await prisma.$transaction([
            prisma.freelancer.findMany({
                where,
                include: { user: { select: { id: true, name: true, rating: true, profilePicture: true, totalReviews: true, bio: true } } },
                orderBy: { rating: 'desc' },
                take: limit,
                skip: (page - 1) * limit
            }),
            prisma.freelancer.count({ where })
        ]);
        res.json({
            success: true,
            freelancers: mapRelation(freelancers),
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getFreelancerById = async (req, res) => {
    try {
        const freelancer = await prisma.freelancer.findFirst({
            where: { id: req.params.id, status: 'approved', user: { is: { status: 'active' } } },
            include: { user: { select: { id: true, name: true, rating: true, profilePicture: true, bio: true } } }
        });
        if (!freelancer) return res.status(404).json({ success: false, message: 'Freelancer not found' });
        await prisma.freelancer.update({ where: { id: freelancer.id }, data: { views: { increment: 1 } } });
        freelancer.views += 1;
        res.json({ success: true, freelancer: mapRelation(freelancer) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateFreelancerProfile = async (req, res) => {
    try {
        const current = await prisma.freelancer.findUnique({ where: { userId: req.user.id } });
        if (!current) return res.status(404).json({ success: false, message: 'Freelancer profile not found' });
        const { title, skills, hourlyRate, experience, portfolio, availability } = req.body;
        const data = {};
        if (title !== undefined) data.title = title;
        if (skills !== undefined) data.skills = skills;
        if (hourlyRate !== undefined) {
            const parsedHourlyRate = Number(hourlyRate);
            if (!Number.isFinite(parsedHourlyRate) || parsedHourlyRate < 0) {
                return res.status(400).json({ success: false, message: 'Hourly rate must be a nonnegative number.' });
            }
            data.hourlyRate = parsedHourlyRate;
        }
        if (experience !== undefined) data.experience = experience;
        if (portfolio !== undefined) data.portfolio = portfolio;
        if (availability !== undefined) data.availability = availability;
        const freelancer = await prisma.freelancer.update({
            where: { id: current.id },
            data,
            include: { user: { select: { id: true, name: true, rating: true, profilePicture: true, bio: true } } }
        });
        res.json({ success: true, freelancer: mapRelation(freelancer) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMyFreelancerProfile = async (req, res) => {
    try {
        const freelancer = await prisma.freelancer.findUnique({ where: { userId: req.user.id } });
        if (!freelancer) return res.status(404).json({ success: false, message: 'Freelancer profile not found' });
        res.json({ success: true, freelancer: mapRelation(freelancer) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMyHireRequests = async (req, res) => {
    try {
        const freelancer = await prisma.freelancer.findUnique({
            where: { userId: req.user.id },
            select: { id: true }
        });
        if (!freelancer) {
            return res.status(404).json({ success: false, message: 'Freelancer profile not found' });
        }
        const requests = await prisma.hireRequest.findMany({
            where: { freelancerId: freelancer.id },
            include: { client: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json({
            success: true,
            requests: requests.map(({ id, client, ...request }) => ({
                ...request,
                _id: id,
                id,
                clientId: client.id,
                clientName: client.name
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createHireRequest = async (req, res) => {
    try {
        const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
        if (!message || message.length > 2000) {
            return res.status(400).json({ success: false, message: 'Message must contain 1-2000 characters' });
        }
        const freelancer = await prisma.freelancer.findFirst({
            where: { id: req.params.id, status: 'approved', user: { is: { status: 'active' } } },
            select: { id: true, userId: true }
        });
        if (!freelancer) return res.status(404).json({ success: false, message: 'Freelancer not found' });
        if (freelancer.userId === req.user.id) {
            return res.status(400).json({ success: false, message: 'You cannot create a hire request for yourself' });
        }
        const existing = await prisma.hireRequest.findFirst({
            where: { clientId: req.user.id, freelancerId: freelancer.id, status: 'pending' }
        });
        if (existing) return res.status(409).json({ success: false, message: 'You already have a pending request for this freelancer' });
        const hireRequest = await prisma.hireRequest.create({
            data: { clientId: req.user.id, freelancerId: freelancer.id, message },
            include: { client: { select: { id: true, name: true } } }
        });
        res.status(201).json({
            success: true,
            request: {
                _id: hireRequest.id,
                id: hireRequest.id,
                clientId: hireRequest.client.id,
                clientName: hireRequest.client.name,
                freelancerId: hireRequest.freelancerId,
                message: hireRequest.message,
                status: hireRequest.status,
                createdAt: hireRequest.createdAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const contactFreelancer = async (req, res) => {
    try {
        const freelancer = await prisma.freelancer.findFirst({
            where: { id: req.params.id, status: 'approved', user: { is: { status: 'active' } } },
            include: { user: { select: { id: true, name: true, status: true } } }
        });
        if (!freelancer) return res.status(404).json({ success: false, message: 'Freelancer not found' });
        if (freelancer.userId === req.user.id) {
            return res.status(400).json({ success: false, message: 'You cannot start a contact request with yourself' });
        }
        res.json({
            success: true,
            message: 'Open a SkillHub conversation to contact this freelancer',
            freelancer: { userId: freelancer.user.id, name: freelancer.user.name }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createFreelancerProfile,
    getFreelancers,
    getFreelancerById,
    updateFreelancerProfile,
    getMyFreelancerProfile,
    getMyHireRequests,
    createHireRequest,
    contactFreelancer
};
