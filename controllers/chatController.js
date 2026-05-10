const Message = require('../models/Message');
const User = require('../models/User');

// ─────────────────────────────────────────────────────────────
// @desc    Send a message
// @route   POST /api/chat/send
// @access  Private
// ─────────────────────────────────────────────────────────────
const sendMessage = async (req, res) => {
    try {
        const { receiverId, content, type, fileUrl, fileName } = req.body;

        if (!receiverId || !content) {
            return res.status(400).json({ success: false, message: 'receiverId and content are required' });
        }

        // Verify receiver exists
        const receiver = await User.findById(receiverId).select('name status');
        if (!receiver) {
            return res.status(404).json({ success: false, message: 'Recipient not found' });
        }

        const conversationId = Message.getConversationId(req.user._id, receiverId);

        const message = await Message.create({
            conversationId,
            senderId: req.user._id,
            receiverId,
            content,
            type: type || 'text',
            fileUrl: fileUrl || null,
            fileName: fileName || null
        });

        // Populate sender info for response
        await message.populate('senderId', 'name profilePicture role');

        res.status(201).json({ success: true, message });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// @desc    Get messages in a conversation
// @route   GET /api/chat/conversation/:userId
// @access  Private
// ─────────────────────────────────────────────────────────────
const getConversation = async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 50, since } = req.query;

        const conversationId = Message.getConversationId(req.user._id, userId);

        const query = { conversationId };

        // For polling — only fetch messages newer than a timestamp
        if (since) {
            query.createdAt = { $gt: new Date(since) };
        }

        const messages = await Message.find(query)
            .populate('senderId', 'name profilePicture role')
            .sort('createdAt')
            .limit(since ? 100 : limit * 1)
            .skip(since ? 0 : (page - 1) * limit);

        // Mark messages as read (messages sent TO current user)
        await Message.updateMany(
            { conversationId, receiverId: req.user._id, read: false },
            { read: true, readAt: new Date() }
        );

        // Get other user info
        const otherUser = await User.findById(userId).select('name profilePicture role status');

        res.json({
            success: true,
            messages,
            otherUser,
            conversationId
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// @desc    Get all conversations for current user
// @route   GET /api/chat/conversations
// @access  Private
// ─────────────────────────────────────────────────────────────
const getConversations = async (req, res) => {
    try {
        const userId = req.user._id;

        // Get the latest message from each conversation involving this user
        const latestMessages = await Message.aggregate([
            {
                $match: {
                    $or: [
                        { senderId: userId },
                        { receiverId: userId }
                    ]
                }
            },
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: '$conversationId',
                    lastMessage: { $first: '$$ROOT' }
                }
            },
            { $sort: { 'lastMessage.createdAt': -1 } },
            { $limit: 50 }
        ]);

        // Populate user info for each conversation
        const conversations = await Promise.all(
            latestMessages.map(async (conv) => {
                const msg = conv.lastMessage;
                // Determine the other participant
                const otherId = msg.senderId.toString() === userId.toString()
                    ? msg.receiverId
                    : msg.senderId;

                const otherUser = await User.findById(otherId).select('name profilePicture role status');

                // Count unread messages in this conversation
                const unreadCount = await Message.countDocuments({
                    conversationId: conv._id,
                    receiverId: userId,
                    read: false
                });

                return {
                    conversationId: conv._id,
                    otherUser,
                    lastMessage: {
                        content: msg.content,
                        type: msg.type,
                        createdAt: msg.createdAt,
                        senderId: msg.senderId
                    },
                    unreadCount
                };
            })
        );

        res.json({ success: true, conversations });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// @desc    Get unread message count
// @route   GET /api/chat/unread
// @access  Private
// ─────────────────────────────────────────────────────────────
const getUnreadCount = async (req, res) => {
    try {
        const count = await Message.countDocuments({
            receiverId: req.user._id,
            read: false
        });
        res.json({ success: true, count });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// @desc    Admin: get ALL conversations
// @route   GET /api/chat/admin/all
// @access  Private (Admin only)
// ─────────────────────────────────────────────────────────────
const adminGetAllConversations = async (req, res) => {
    try {
        const latestMessages = await Message.aggregate([
            { $sort: { createdAt: -1 } },
            {
                $group: {
                    _id: '$conversationId',
                    lastMessage: { $first: '$$ROOT' },
                    messageCount: { $sum: 1 }
                }
            },
            { $sort: { 'lastMessage.createdAt': -1 } },
            { $limit: 100 }
        ]);

        const conversations = await Promise.all(
            latestMessages.map(async (conv) => {
                const msg = conv.lastMessage;
                const [user1, user2] = await Promise.all([
                    User.findById(msg.senderId).select('name profilePicture role'),
                    User.findById(msg.receiverId).select('name profilePicture role')
                ]);
                return {
                    conversationId: conv._id,
                    user1,
                    user2,
                    lastMessage: {
                        content: msg.content,
                        createdAt: msg.createdAt,
                        senderId: msg.senderId
                    },
                    messageCount: conv.messageCount
                };
            })
        );

        res.json({ success: true, conversations });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// @desc    Admin: get full conversation by ID
// @route   GET /api/chat/admin/conversation/:conversationId
// @access  Private (Admin only)
// ─────────────────────────────────────────────────────────────
const adminGetConversation = async (req, res) => {
    try {
        const { conversationId } = req.params;
        const messages = await Message.find({ conversationId })
            .populate('senderId', 'name profilePicture role')
            .populate('receiverId', 'name profilePicture role')
            .sort('createdAt');

        res.json({ success: true, messages, conversationId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// ─────────────────────────────────────────────────────────────
// @desc    Delete a message (soft delete)
// @route   DELETE /api/chat/message/:id
// @access  Private
// ─────────────────────────────────────────────────────────────
const deleteMessage = async (req, res) => {
    try {
        const message = await Message.findById(req.params.id);
        if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

        if (message.senderId.toString() === req.user._id.toString()) {
            message.deletedBySender = true;
        } else if (message.receiverId.toString() === req.user._id.toString()) {
            message.deletedByReceiver = true;
        } else {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        await message.save();
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
    adminGetAllConversations,
    adminGetConversation,
    deleteMessage
};
