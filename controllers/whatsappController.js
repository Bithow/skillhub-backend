const crypto = require('crypto');
const prisma = require('../utils/prisma');
const WhatsAppService = require('../utils/whatsappService');
const newReference = () => `TXN_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const mapRelation = value => {
    if (!value) return value;
    if (Array.isArray(value)) return value.map(mapRelation);
    if (typeof value !== 'object' || value instanceof Date) return value;
    const { id, ...fields } = value;
    const mapped = { ...fields, _id: id, id };
    for (const [key, nested] of Object.entries(mapped)) {
        const apiKey = key === 'respondedBy' ? 'respondedBy' : key;
        mapped[apiKey] = nested && typeof nested === 'object' ? mapRelation(nested) : nested;
    }
    return mapped;
};

const handleWebhook = async (req, res) => {
    try {
        const body = req.body;
        if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
            return res.status(200).send(req.query['hub.challenge']);
        }
        if (body.entry) {
            for (const entry of body.entry) {
                for (const change of entry.changes || []) {
                    if (change.field !== 'messages') continue;
                    for (const message of change.value.messages || []) {
                        await processIncomingMessage(message);
                    }
                }
            }
        }
        res.sendStatus(200);
    } catch (error) {
        console.error('WhatsApp webhook error:', error);
        res.sendStatus(500);
    }
};

const processIncomingMessage = async message => {
    const from = message.from;
    const text = message.text?.body || '';
    const lowerText = text.toLowerCase();
    const whatsappMessage = await prisma.whatsAppMessage.create({
        data: {
            messageId: message.id || null,
            from,
            to: process.env.ADMIN_WHATSAPP || '',
            message: text,
            type: 'inquiry',
            status: 'delivered'
        }
    });
    let reply = '';

    if (lowerText.includes('course') || lowerText.includes('learn')) {
        reply = `SkillHub Courses\n\nReply with "courses" to browse, or "category [name]" to filter.`;
        if (lowerText.includes('courses')) {
            const keyword = lowerText.replace('courses', '').trim();
            const courses = await prisma.course.findMany({
                where: { status: 'published', ...(keyword ? { title: { contains: keyword, mode: 'insensitive' } } : {}) },
                take: 5,
                orderBy: { createdAt: 'desc' }
            });
            if (courses.length) reply = `Top Courses\n\n${courses.map((course, index) => `${index + 1}. ${course.title}\n   $${Number(course.price).toFixed(2)} USD\n   ${course.instructorName || ''}\n   ${process.env.FRONTEND_URL}/course.html?id=${course.id}`).join('\n\n')}`;
        }
    } else if (lowerText.includes('freelance') || lowerText.includes('hire') || lowerText.includes('freelancer')) {
        reply = `Hire Freelancers\n\nReply with "freelancers" to browse or "skill [name]" to filter.`;
        if (lowerText.includes('freelancers')) {
            const skill = lowerText.replace('freelancers', '').replace('skill', '').trim();
            const freelancers = await prisma.freelancer.findMany({
                where: {
                    status: 'approved',
                    user: { is: { status: 'active' } },
                    ...(skill ? { skills: { has: skill } } : {})
                },
                include: { user: { select: { id: true, name: true } } },
                take: 5,
                orderBy: { rating: 'desc' }
            });
            if (freelancers.length) reply = `Top Freelancers\n\n${freelancers.map((freelancer, index) => `${index + 1}. ${freelancer.user.name}\n   $${Number(freelancer.hourlyRate).toFixed(2)} USD/hr\n   ${freelancer.skills.slice(0, 3).join(', ')}\n   ${process.env.FRONTEND_URL}/chat.html?userId=${freelancer.user.id}`).join('\n\n')}`;
        }
    } else if (lowerText.includes('instructor') || lowerText.includes('teach')) {
        reply = `Become an Instructor\n\nApply here: ${process.env.FRONTEND_URL}/index.html#become-instructor`;
    } else if (lowerText.includes('balance') || lowerText.includes('wallet')) {
        const user = await prisma.user.findUnique({ where: { phone: from } });
        reply = user ? `Your wallet balance is $${Number(user.walletBalance).toFixed(2)} USD. Reply "withdraw [amount]" to request a withdrawal.` : `Please register on SkillHub first: ${process.env.FRONTEND_URL}/index.html`;
    } else if (lowerText.startsWith('withdraw')) {
        const withdrawalMatch = lowerText.match(/^withdraw\s+\$?(\d+(?:\.\d{1,2})?)$/i);
        const amount = withdrawalMatch ? Number(withdrawalMatch[1]) : Number.NaN;
        const user = await prisma.user.findUnique({ where: { phone: from } });
        if (user && Number.isFinite(amount) && amount >= 5) {
            const transaction = await prisma.$transaction(async tx => {
                const reserved = await tx.user.updateMany({
                    where: { id: user.id, walletBalance: { gte: amount } },
                    data: { walletBalance: { decrement: amount } }
                });
                if (reserved.count !== 1) return null;
                return tx.transaction.create({
                    data: {
                        userId: user.id,
                        type: 'withdrawal',
                        amount,
                        netAmount: amount,
                        status: 'pending',
                        paymentMethod: 'whatsapp',
                        reference: newReference(),
                        metadata: { whatsappMessageId: whatsappMessage.id, balanceReserved: true }
                    }
                });
            });
            reply = transaction
                ? `Withdrawal request of $${amount.toFixed(2)} USD submitted. Admin will process it.`
                : `Insufficient balance. Your balance is $${Number(user.walletBalance).toFixed(2)} USD.`;
        } else {
            reply = `Invalid amount. Minimum withdrawal: $5.00 USD. Example: "withdraw 5.00"`;
        }
    } else if (lowerText.includes('help') || lowerText.includes('menu')) {
        reply = `SkillHub Help Menu\n\nCourses: browse and purchase\nFreelance: contact freelancers through in-app chat\nInstructor: teach and earn\nBalance: check wallet\nWithdraw: request withdrawal\n\nSupport: ${process.env.ADMIN_WHATSAPP}\n${process.env.FRONTEND_URL}`;
    } else {
        reply = `Welcome to SkillHub! Reply "courses", "freelancers", "instructor", "balance", or "help".\n${process.env.FRONTEND_URL}`;
    }

    if (reply) {
        await WhatsAppService.sendToNumber(from, reply);
        await prisma.whatsAppMessage.update({
            where: { id: whatsappMessage.id },
            data: { response: reply, respondedAt: new Date() }
        });
    }
};

const sendBroadcast = async (req, res) => {
    try {
        const message = String(req.body.message || '').trim();
        const batchSize = Math.min(500, Math.max(1, Number.parseInt(req.body.batchSize, 10) || 50));
        if (!message) return res.status(400).json({ success: false, message: 'Message is required' });
        const where = { status: 'active' };
        if (req.body.role) where.role = req.body.role;
        const users = await prisma.user.findMany({ where, select: { name: true, phone: true }, take: 10000 });
        let sent = 0;
        let failed = 0;
        for (let i = 0; i < users.length; i += batchSize) {
            await Promise.all(users.slice(i, i + batchSize).map(async user => {
                if (!user.phone) { failed++; return; }
                const personalizedMessage = message.replaceAll('{name}', user.name);
                try {
                    await WhatsAppService.sendToNumber(user.phone, personalizedMessage);
                    await prisma.whatsAppMessage.create({
                        data: {
                            from: process.env.ADMIN_WHATSAPP || '',
                            to: user.phone,
                            message: personalizedMessage,
                            type: 'broadcast',
                            status: 'sent'
                        }
                    });
                    sent++;
                } catch (error) {
                    failed++;
                    console.error('WhatsApp broadcast delivery failed');
                }
            }));
        }
        res.json({ success: true, message: 'Broadcast complete', stats: { total: users.length, sent, failed } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMessages = async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const where = {};
        if (req.query.status) where.status = req.query.status;
        if (req.query.type) where.type = req.query.type;
        const [messages, total] = await prisma.$transaction([
            prisma.whatsAppMessage.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }),
            prisma.whatsAppMessage.count({ where })
        ]);
        res.json({ success: true, messages: mapRelation(messages), totalPages: Math.ceil(total / limit), currentPage: page, total });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { handleWebhook, sendBroadcast, getMessages };
