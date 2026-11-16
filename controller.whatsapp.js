const WhatsAppMessage = require('../models/WhatsAppMessage');
const User = require('../models/User');
const Course = require('../models/Course');
const Freelancer = require('../models/Freelancer');
const Transaction = require('../models/Transaction');
const WhatsAppService = require('../utils/whatsappService');

// @desc    Handle WhatsApp webhook (incoming messages)
// @route   POST /api/whatsapp/webhook
// @access  Public (Facebook verification required)
const handleWebhook = async (req, res) => {
    try {
        const body = req.body;
        
        // Verify webhook (Facebook/Meta)
        if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
            return res.status(200).send(req.query['hub.challenge']);
        }
        
        // Process incoming messages
        if (body.entry) {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    if (change.field === 'messages') {
                        const messages = change.value.messages;
                        for (const message of messages) {
                            await processIncomingMessage(message, change.value.contacts?.[0]);
                        }
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

// Process incoming WhatsApp messages
const processIncomingMessage = async (message, contact) => {
    const from = message.from;
    const text = message.text?.body || '';
    const lowerText = text.toLowerCase();
    
    // Save message to database
    const whatsappMessage = await WhatsAppMessage.create({
        messageId: message.id,
        from: from,
        to: process.env.ADMIN_WHATSAPP,
        message: text,
        type: 'inquiry',
        status: 'delivered'
    });
    
    // Auto-reply based on keywords
    let reply = '';
    
    if (lowerText.includes('course') || lowerText.includes('learn')) {
        reply = `🎓 *SkillHub Courses*\n\nReply with:\n1️⃣ "courses" - Browse all courses\n2️⃣ "category [name]" - Filter by category\n3️⃣ "price [max]" - Filter by price\n\nExample: "courses web development"`;
        
        // Fetch courses from database
        if (lowerText.includes('courses')) {
            const keyword = lowerText.replace('courses', '').trim();
            const query = keyword ? { title: { $regex: keyword, $options: 'i' }, status: 'published' } : { status: 'published' };
            const courses = await Course.find(query).limit(5);
            
            if (courses.length > 0) {
                reply = `📚 *Top Courses*\n\n`;
                courses.forEach((course, index) => {
                    reply += `${index + 1}. *${course.title}*\n   💰 $${Number(course.price).toFixed(2)} USD\n   👨‍🏫 ${course.instructorName}\n   🔗 ${process.env.FRONTEND_URL}/courses/${course._id}\n\n`;
                });
            }
        }
    }
    else if (lowerText.includes('freelance') || lowerText.includes('hire') || lowerText.includes('freelancer')) {
        reply = `💼 *Hire Freelancers*\n\nReply with:\n1️⃣ "freelancers" - Browse all\n2️⃣ "skill [name]" - Filter by skill\n3️⃣ "rate [max]" - Filter by rate\n\nExample: "skill web development"`;
        
        if (lowerText.includes('freelancers')) {
            const skill = lowerText.replace('freelancers', '').replace('skill', '').trim();
            const query = skill ? { skills: { $in: [new RegExp(skill, 'i')] }, status: 'approved' } : { status: 'approved' };
            const freelancers = await Freelancer.find(query).populate('userId', 'name').limit(5);
            
            if (freelancers.length > 0) {
                reply = `👨‍💻 *Top Freelancers*\n\n`;
                freelancers.forEach((freelancer, index) => {
                    reply += `${index + 1}. *${freelancer.userId.name}*\n   💰 $${Number(freelancer.hourlyRate).toFixed(2)} USD/hr\n   🛠️ ${freelancer.skills.slice(0, 3).join(', ')}\n   🔗 ${process.env.FRONTEND_URL}/freelancers/${freelancer._id}\n\n`;
                });
            }
        }
    }
    else if (lowerText.includes('instructor') || lowerText.includes('teach')) {
        reply = `👨‍🏫 *Become an Instructor*\n\nShare your skills and earn money!\n\n📝 Apply here: ${process.env.FRONTEND_URL}/become-instructor\n\nRequirements:\n✅ Expertise in your field\n✅ Good communication skills\n✅ Passion for teaching`;
    }
    else if (lowerText.includes('balance') || lowerText.includes('wallet')) {
        // Find user by phone
        const user = await User.findOne({ phone: from });
        if (user) {
            reply = `💰 *Your Wallet*\n\nBalance: $${Number(user.walletBalance).toFixed(2)} USD\n\nReply "withdraw [amount]" to request withdrawal\nMinimum withdrawal: $5.00 USD`;
        } else {
            reply = `🔐 Please register on SkillHub first: ${process.env.FRONTEND_URL}/register`;
        }
    }
    else if (lowerText.startsWith('withdraw')) {
        const withdrawalMatch = lowerText.match(/^withdraw\s+\$?(\d+(?:\.\d{1,2})?)$/i);
        const amount = withdrawalMatch ? Number(withdrawalMatch[1]) : Number.NaN;
        const user = await User.findOne({ phone: from });
        
        if (user && Number.isFinite(amount) && amount >= 5 && amount <= user.walletBalance) {
            await Transaction.create({
                userId: user._id,
                type: 'withdrawal',
                amount: amount,
                netAmount: amount,
                status: 'pending',
                paymentMethod: 'whatsapp',
                metadata: { whatsappMessageId: whatsappMessage._id }
            });
            
            reply = `✅ Withdrawal request of $${amount.toFixed(2)} USD submitted. Admin will process within 24 hours.`;
        } else if (user && amount && amount > user.walletBalance) {
            reply = `❌ Insufficient balance. Your balance is $${Number(user.walletBalance).toFixed(2)} USD.`;
        } else {
            reply = `❌ Invalid amount. Minimum withdrawal: $5.00 USD\nExample: "withdraw 5.00"`;
        }
    }
    else if (lowerText.includes('help') || lowerText.includes('menu')) {
        reply = `📋 *SkillHub Help Menu*\n\n🔹 *Courses* - Browse and purchase courses\n🔹 *Freelance* - Hire freelancers\n🔹 *Instructor* - Teach and earn\n🔹 *Balance* - Check wallet balance\n🔹 *Withdraw* - Request withdrawal\n\n📞 Contact support: ${process.env.ADMIN_WHATSAPP}\n🌐 Website: ${process.env.FRONTEND_URL}`;
    }
    else {
        reply = `👋 Welcome to SkillHub!\n\nReply with:\n📚 "courses" - Browse courses\n💼 "freelancers" - Hire freelancers\n👨‍🏫 "instructor" - Become instructor\n💰 "balance" - Check wallet\n❓ "help" - Full menu\n\nOr visit: ${process.env.FRONTEND_URL}`;
    }
    
    // Send reply
    if (reply) {
        await WhatsAppService.sendToNumber(from, reply);
        
        // Save response
        whatsappMessage.response = reply;
        whatsappMessage.respondedAt = Date.now();
        await whatsappMessage.save();
    }
};

// @desc    Send bulk WhatsApp message (broadcast)
// @route   POST /api/whatsapp/broadcast
// @access  Private (Admin only)
const sendBroadcast = async (req, res) => {
    try {
        const { message, role, batchSize = 50 } = req.body;
        
        const query = { status: 'active' };
        if (role) query.role = role;
        
        const users = await User.find(query).select('phone name');
        
        let sent = 0;
        let failed = 0;
        
        for (let i = 0; i < users.length; i += batchSize) {
            const batch = users.slice(i, i + batchSize);
            await Promise.all(batch.map(async (user) => {
                try {
                    const personalizedMessage = message.replace('{name}', user.name);
                    await WhatsAppService.sendToNumber(user.phone, personalizedMessage);
                    
                    await WhatsAppMessage.create({
                        from: process.env.ADMIN_WHATSAPP,
                        to: user.phone,
                        message: personalizedMessage,
                        type: 'broadcast',
                        status: 'sent'
                    });
                    sent++;
                } catch (error) {
                    failed++;
                    console.error(`Failed to send to ${user.phone}:`, error);
                }
            }));
            
            // Delay between batches
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        
        res.json({
            success: true,
            message: `Broadcast complete`,
            stats: { total: users.length, sent, failed }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get WhatsApp message history
// @route   GET /api/whatsapp/messages
// @access  Private (Admin only)
const getMessages = async (req, res) => {
    try {
        const { page = 1, limit = 50, status, type } = req.query;
        
        const query = {};
        if (status) query.status = status;
        if (type) query.type = type;
        
        const messages = await WhatsAppMessage.find(query)
            .sort('-createdAt')
            .limit(limit * 1)
            .skip((page - 1) * limit);
        
        const total = await WhatsAppMessage.countDocuments(query);
        
        res.json({
            success: true,
            messages,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

module.exports = {
    handleWebhook,
    sendBroadcast,
    getMessages
};