const prisma = require('../utils/prisma');

const mapRelation = value => {
    if (!value) return value;
    if (Array.isArray(value)) return value.map(mapRelation);
    if (typeof value !== 'object' || value instanceof Date) return value;
    const { id, ...fields } = value;
    const mapped = { ...fields, _id: id, id };
    for (const [key, nested] of Object.entries(mapped)) {
        const apiKey = key === 'sender' ? 'senderId' : key === 'receiver' ? 'receiverId' : key;
        if (apiKey !== key) delete mapped[key];
        mapped[apiKey] = nested && typeof nested === 'object' ? mapRelation(nested) : nested;
    }
    return mapped;
};
const conversationIdFor = (first, second) => [String(first), String(second)].sort().join('_');
const validPage = value => Math.max(1, Number.parseInt(value, 10) || 1);

const sendMessage = async (req, res) => {
    try {
        const { receiverId, content, type, fileUrl, fileName } = req.body;
        if (!receiverId || !content) return res.status(400).json({ success: false, message: 'receiverId and content are required' });
        if (typeof receiverId !== 'string' || receiverId === req.user.id) return res.status(400).json({ success: false, message: 'Invalid message recipient' });
        if (typeof content !== 'string' || content.length > 2000) return res.status(400).json({ success: false, message: 'Message cannot exceed 2000 characters' });
        if (!['text', 'image', 'file'].includes(type || 'text')) return res.status(400).json({ success: false, message: 'Invalid message type' });
        const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { id: true, name: true, status: true } });
        if (!receiver) return res.status(404).json({ success: false, message: 'Recipient not found' });
        if (['suspended', 'rejected'].includes(receiver.status)) return res.status(403).json({ success: false, message: 'Recipient cannot receive messages' });
        const message = await prisma.message.create({
            data: {
                conversationId: conversationIdFor(req.user.id, receiverId),
                senderId: req.user.id,
                receiverId,
                content: content.trim(),
                type: type || 'text',
                fileUrl: fileUrl || null,
                fileName: fileName || null
            },
            include: { sender: { select: { id: true, name: true, profilePicture: true, role: true } } }
        });
        res.status(201).json({ success: true, message: mapRelation(message) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const sendTypingSignal = async (req, res) => {
    try {
        const receiverId = req.body.receiverId;
        if (typeof receiverId !== 'string' || receiverId === req.user.id) {
            return res.status(400).json({ success: false, message: 'Valid receiverId is required' });
        }
        const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { id: true, status: true } });
        if (!receiver || ['suspended', 'rejected'].includes(receiver.status)) {
            return res.status(404).json({ success: false, message: 'Recipient not found' });
        }
        await prisma.chatTyping.upsert({
            where: { senderId_receiverId: { senderId: req.user.id, receiverId } },
            create: { senderId: req.user.id, receiverId, expiresAt: new Date(Date.now() + 6000) },
            update: { expiresAt: new Date(Date.now() + 6000) }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getTypingStatus = async (req, res) => {
    try {
        const senderId = req.params.userId;
        if (typeof senderId !== 'string' || senderId === req.user.id) {
            return res.status(400).json({ success: false, message: 'Invalid conversation user' });
        }
        const recentSignal = await prisma.chatTyping.findUnique({
            where: {
                senderId_receiverId: { senderId, receiverId: req.user.id }
            },
        });
        res.json({ success: true, isTyping: Boolean(recentSignal && recentSignal.expiresAt > new Date()) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const searchUsers = async (req, res) => {
    try {
        const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        if (query.length < 2) return res.json({ success: true, users: [] });
        const users = await prisma.user.findMany({
            where: {
                id: { not: req.user.id },
                status: 'active',
                OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { username: { contains: query, mode: 'insensitive' } },
                    { email: { contains: query, mode: 'insensitive' } }
                ]
            },
            select: { id: true, name: true, role: true, profilePicture: true },
            orderBy: { name: 'asc' },
            take: 20
        });
        res.json({
            success: true,
            users: users.map(user => ({ ...user, _id: user.id }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getConversation = async (req, res) => {
    try {
        const { userId } = req.params;
        if (typeof userId !== 'string') return res.status(400).json({ success: false, message: 'Invalid conversation user' });
        const otherUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, name: true, profilePicture: true, role: true, status: true }
        });
        if (!otherUser) return res.status(404).json({ success: false, message: 'Conversation user not found' });
        const page = validPage(req.query.page);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const where = {
            conversationId: conversationIdFor(req.user.id, userId),
            NOT: { type: 'system', content: '' }
        };
        if (req.query.since) {
            const since = new Date(req.query.since);
            if (Number.isNaN(since.getTime())) return res.status(400).json({ success: false, message: 'Invalid since timestamp' });
            where.createdAt = { gt: since };
        }
        const messages = await prisma.message.findMany({
            where,
            include: { sender: { select: { id: true, name: true, profilePicture: true, role: true } } },
            orderBy: { createdAt: 'asc' },
            take: req.query.since ? 100 : limit,
            skip: req.query.since ? 0 : (page - 1) * limit
        });
        await prisma.message.updateMany({
            where: { conversationId: where.conversationId, receiverId: req.user.id, read: false },
            data: { read: true, readAt: new Date() }
        });
        res.json({
            success: true,
            messages: mapRelation(messages),
            otherUser: mapRelation(otherUser),
            conversationId: where.conversationId
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getConversations = async (req, res) => {
    try {
        const userId = req.user.id;
        const grouped = await prisma.message.groupBy({
            by: ['conversationId'],
            where: {
                OR: [{ senderId: userId }, { receiverId: userId }],
                NOT: { type: 'system', content: '' }
            },
            _max: { createdAt: true },
            orderBy: { _max: { createdAt: 'desc' } },
            take: 50
        });
        if (!grouped.length) return res.json({ success: true, conversations: [] });

        const conversationIds = grouped.map(g => g.conversationId);

        // Fetch the latest message per conversation and unread counts in two bulk queries
        const [latestMessages, unreadCounts] = await Promise.all([
            prisma.message.findMany({
                where: { conversationId: { in: conversationIds } },
                orderBy: { createdAt: 'desc' },
                distinct: ['conversationId'],
                select: { conversationId: true, senderId: true, receiverId: true, content: true, type: true, createdAt: true }
            }),
            prisma.message.groupBy({
                by: ['conversationId'],
                where: { conversationId: { in: conversationIds }, receiverId: userId, read: false },
                _count: { _all: true }
            })
        ]);

        // Build a lookup map for unread counts
        const unreadMap = Object.fromEntries(unreadCounts.map(u => [u.conversationId, u._count._all]));

        // Collect all other-user IDs in one shot
        const otherUserIds = [...new Set(latestMessages.map(m => m.senderId === userId ? m.receiverId : m.senderId))];
        const otherUsers = await prisma.user.findMany({
            where: { id: { in: otherUserIds } },
            select: { id: true, name: true, profilePicture: true, role: true, status: true }
        });
        const userMap = Object.fromEntries(otherUsers.map(u => [u.id, u]));

        const messageMap = Object.fromEntries(latestMessages.map(m => [m.conversationId, m]));
        const conversations = conversationIds.map(convId => {
            const message = messageMap[convId];
            if (!message) return null;
            const otherId = message.senderId === userId ? message.receiverId : message.senderId;
            return {
                conversationId: convId,
                otherUser: mapRelation(userMap[otherId] || null),
                lastMessage: { content: message.content, type: message.type, createdAt: message.createdAt, senderId: message.senderId },
                unreadCount: unreadMap[convId] || 0
            };
        }).filter(Boolean);

        res.json({ success: true, conversations });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getUnreadCount = async (req, res) => {
    try {
        const count = await prisma.message.count({ where: { receiverId: req.user.id, read: false } });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const adminGetAllConversations = async (req, res) => {
    try {
        const grouped = await prisma.message.groupBy({
            by: ['conversationId'],
            where: { NOT: { type: 'system', content: '' } },
            _max: { createdAt: true },
            _count: { _all: true },
            orderBy: { _max: { createdAt: 'desc' } },
            take: 100
        });
        const conversations = await Promise.all(grouped.map(async group => {
            const id = group.conversationId;
            const message = await prisma.message.findFirst({ where: { conversationId: id }, orderBy: { createdAt: 'desc' } });
            const [user1, user2] = await Promise.all([
                prisma.user.findUnique({ where: { id: message.senderId }, select: { id: true, name: true, profilePicture: true, role: true } }),
                prisma.user.findUnique({ where: { id: message.receiverId }, select: { id: true, name: true, profilePicture: true, role: true } })
            ]);
            return {
                conversationId: id,
                user1: mapRelation(user1),
                user2: mapRelation(user2),
                lastMessage: { content: message.content, createdAt: message.createdAt, senderId: message.senderId },
                messageCount: group._count._all
            };
        }));
        res.json({ success: true, conversations });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const adminGetConversation = async (req, res) => {
    try {
        const messages = await prisma.message.findMany({
            where: { conversationId: req.params.conversationId },
            include: {
                sender: { select: { id: true, name: true, profilePicture: true, role: true } },
                receiver: { select: { id: true, name: true, profilePicture: true, role: true } }
            },
            orderBy: { createdAt: 'asc' }
        });
        res.json({ success: true, messages: mapRelation(messages), conversationId: req.params.conversationId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteMessage = async (req, res) => {
    try {
        const message = await prisma.message.findUnique({ where: { id: req.params.id } });
        if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
        if (message.senderId !== req.user.id && message.receiverId !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }
        const data = message.senderId === req.user.id ? { deletedBySender: true } : { deletedByReceiver: true };
        await prisma.message.update({ where: { id: message.id }, data });
        res.json({ success: true, message: 'Message deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    sendMessage,
    getConversation,
    getConversations,
    getUnreadCount,
    sendTypingSignal,
    getTypingStatus,
    searchUsers,
    adminGetAllConversations,
    adminGetConversation,
    deleteMessage
};
