const prisma = require('../utils/prisma');
const WhatsAppService = require('../utils/whatsappService');

const mapRelation = value => {
    if (!value) return value;
    if (Array.isArray(value)) return value.map(mapRelation);
    if (typeof value !== 'object' || value instanceof Date) return value;
    const { id, ...fields } = value;
    const mapped = { ...fields, _id: id, id };
    for (const [key, nested] of Object.entries(mapped)) {
        const apiKey = key === 'user' ? 'userId' : key === 'instructor' ? 'instructorId' : key;
        if (apiKey !== key) delete mapped[key];
        mapped[apiKey] = nested && typeof nested === 'object' ? mapRelation(nested) : nested;
    }
    return mapped;
};
const pageValue = value => Math.max(1, Number.parseInt(value, 10) || 1);
const limitValue = value => Math.min(100, Math.max(1, Number.parseInt(value, 10) || 20));
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const getStats = async (req, res) => {
    try {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const [totalUsers, pendingInstructors, pendingFreelancers, pendingCourses, totalCourses,
            totalFreelancers, completedTransactions, monthlyTransactions, totalTransactions] = await Promise.all([
            prisma.user.count(),
            prisma.user.count({ where: { role: 'instructor', status: 'pending' } }),
            prisma.user.count({ where: { role: 'freelancer', status: 'pending' } }),
            prisma.course.count({ where: { status: 'pending' } }),
            prisma.course.count({ where: { status: 'published' } }),
            prisma.freelancer.count({ where: { status: 'approved' } }),
            prisma.transaction.aggregate({ where: { status: 'completed', type: 'commission' }, _sum: { amount: true } }),
            prisma.transaction.aggregate({ where: { status: 'completed', createdAt: { gte: monthStart } }, _sum: { amount: true } }),
            prisma.transaction.count()
        ]);
        res.json({ success: true, stats: {
            totalUsers, pendingInstructors, pendingFreelancers, pendingCourses, totalCourses, totalFreelancers,
            totalRevenue: completedTransactions._sum.amount || 0,
            monthlyRevenue: monthlyTransactions._sum.amount || 0,
            totalTransactions
        } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getPendingApprovals = async (req, res) => {
    try {
        const [pendingInstructors, pendingFreelancers, courses] = await Promise.all([
            prisma.user.findMany({ where: { role: 'instructor', status: 'pending' } }),
            prisma.user.findMany({ where: { role: 'freelancer', status: 'pending' } }),
            prisma.course.findMany({ where: { status: 'pending' }, include: { instructor: { select: { id: true, name: true, email: true } } } })
        ]);
        res.json({ success: true, pending: {
            instructors: mapRelation(pendingInstructors),
            freelancers: mapRelation(pendingFreelancers),
            courses: mapRelation(courses)
        } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const approveUser = async (req, res) => {
    try {
        const { role, message } = req.body;
        const user = await prisma.$transaction(async tx => {
            const existing = await tx.user.findUnique({ where: { id: req.params.id } });
            if (!existing) return null;
            const updated = await tx.user.update({ where: { id: existing.id }, data: { status: 'active' } });
            if (existing.role === 'freelancer') {
                await tx.freelancer.updateMany({ where: { userId: existing.id }, data: { status: 'approved' } });
            }
            return updated;
        });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.phone) {
            await WhatsAppService.sendToNumber(user.phone,
                `Your ${role || user.role} application has been APPROVED on SkillHub.\n\n${message || 'You can now start creating courses and earning money.'}\n\nLogin to your dashboard: ${process.env.FRONTEND_URL}`);
        }
        res.json({ success: true, message: 'User approved successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const rejectUser = async (req, res) => {
    try {
        const user = await prisma.user.update({ where: { id: req.params.id }, data: { status: 'rejected' } }).catch(error => {
            if (error.code === 'P2025') return null;
            throw error;
        });
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (user.phone) {
            await WhatsAppService.sendToNumber(user.phone,
                `Your ${user.role} application was not approved.\n\nReason: ${req.body.reason || 'Please check your information and reapply.'}\n\nContact support for more information.`);
        }
        res.json({ success: true, message: 'User rejected' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateCourseStatus = async (req, res, status) => {
    try {
        const course = await prisma.course.findUnique({ where: { id: req.params.id }, include: { instructor: true } });
        if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
        const updated = await prisma.course.update({
            where: { id: course.id },
            data: status === 'rejected'
                ? { status, rejectionReason: req.body.reason || null }
                : { status }
        });
        if (course.instructor.phone) {
            const message = status === 'published'
                ? `Your course "${course.title}" has been APPROVED and is now live on SkillHub!\n\nShare it with your students: ${process.env.FRONTEND_URL}/courses/${course.id}`
                : `Your course "${course.title}" was not approved.\n\nReason: ${req.body.reason || 'Please review and resubmit.'}\n\nYou can edit and resubmit from your dashboard.`;
            await WhatsAppService.sendToNumber(course.instructor.phone, message);
        }
        res.json({ success: true, message: status === 'published' ? 'Course approved successfully' : 'Course rejected', course: mapRelation(updated) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
const approveCourse = (req, res) => updateCourseStatus(req, res, 'published');
const rejectCourse = (req, res) => updateCourseStatus(req, res, 'rejected');

const setCourseFeatured = async (req, res) => {
    try {
        if (typeof req.body.isFeatured !== 'boolean') {
            return res.status(400).json({ success: false, message: 'isFeatured must be a boolean' });
        }
        const course = await prisma.course.findUnique({ where: { id: req.params.id } });
        if (!course) return res.status(404).json({ success: false, message: 'Course not found' });
        if (course.status !== 'published') {
            return res.status(400).json({ success: false, message: 'Only published courses can be featured' });
        }
        const updated = await prisma.course.update({
            where: { id: course.id },
            data: { isFeatured: req.body.isFeatured }
        });
        res.json({ success: true, course: mapRelation(updated) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAllUsers = async (req, res) => {
    try {
        const page = pageValue(req.query.page);
        const limit = limitValue(req.query.limit);
        const where = {};
        if (req.query.role) where.role = req.query.role;
        if (req.query.status) where.status = req.query.status;
        if (req.query.search) where.OR = ['name', 'email', 'phone'].map(field => ({ [field]: { contains: req.query.search, mode: 'insensitive' } }));
        const [users, total] = await prisma.$transaction([
            prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }),
            prisma.user.count({ where })
        ]);
        res.json({ success: true, users: mapRelation(users), totalPages: Math.ceil(total / limit), currentPage: page, total });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAllTransactions = async (req, res) => {
    try {
        const page = pageValue(req.query.page);
        const limit = limitValue(req.query.limit);
        const where = {};
        if (req.query.status) where.status = req.query.status;
        if (req.query.type) where.type = req.query.type;
        const [transactions, total] = await prisma.$transaction([
            prisma.transaction.findMany({ where, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }),
            prisma.transaction.count({ where })
        ]);
        res.json({ success: true, transactions: mapRelation(transactions), totalPages: Math.ceil(total / limit), currentPage: page, total });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const adminRoleCatalog = [
    { id: 'super_admin', label: 'Super Admin', permissions: ['all'] },
    { id: 'platform_manager', label: 'Platform Manager', permissions: ['users:view', 'courses:view', 'projects:view', 'messages:view', 'financial:view', 'settings:view'] },
    { id: 'course_manager', label: 'Course Manager', permissions: ['courses:view', 'courses:approve', 'users:view', 'ai_studio:view', 'ai_studio:manage'] },
    { id: 'freelance_manager', label: 'Freelance Manager', permissions: ['freelancers:view', 'projects:view', 'projects:approve', 'messages:view'] },
    { id: 'support_admin', label: 'Support Admin', permissions: ['messages:view', 'tickets:view', 'tickets:respond'] },
    { id: 'finance_manager', label: 'Finance Manager', permissions: ['financial:view', 'financial:review', 'withdrawals:view', 'refunds:view', 'reports:export'] },
    { id: 'finance_reviewer', label: 'Finance Reviewer', permissions: ['financial:view', 'financial:review'] },
    { id: 'content_moderator', label: 'Content Moderator', permissions: ['courses:view', 'reviews:view', 'messages:view', 'reports:view'] },
    { id: 'business_manager', label: 'Business Solutions Manager', permissions: ['business:view', 'business:approve', 'messages:view'] },
    { id: 'analyst', label: 'Analyst / Auditor', permissions: ['reports:view', 'analytics:view', 'financial:view'] }
];

const getAdminRoleCatalog = async (req, res) => {
    res.json({ success: true, roles: adminRoleCatalog });
};

const getAdminRoleUsers = async (req, res) => {
    try {
        const admins = await prisma.user.findMany({
            where: { role: 'admin' },
            select: { id: true, name: true, email: true, adminRole: true, adminPermissions: true, status: true, createdAt: true }
        });
        res.json({ success: true, admins: admins.map(user => ({ ...user, _id: user.id, id: user.id })) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateAdminRolePermissions = async (req, res) => {
    try {
        const targetUser = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (!targetUser || targetUser.role !== 'admin') {
            return res.status(404).json({ success: false, message: 'Admin user not found' });
        }
        const role = typeof req.body.role === 'string' ? req.body.role : targetUser.adminRole || 'super_admin';
        const catalog = adminRoleCatalog.find(item => item.id === role);
        const permissions = Array.isArray(req.body.permissions) && req.body.permissions.length
            ? req.body.permissions
            : (catalog ? catalog.permissions : []);
        const updated = await prisma.user.update({
            where: { id: targetUser.id },
            data: { adminRole: role, adminPermissions: permissions }
        });
        res.json({ success: true, user: { ...updated, _id: updated.id, id: updated.id }, role, permissions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateTransactionStatus = async (req, res) => {
    const { status } = req.body;
    if (!['completed', 'failed', 'refunded'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Status must be completed, failed, or refunded' });
    }
    try {
        const transaction = await prisma.$transaction(async tx => {
            const current = await tx.transaction.findUnique({ where: { id: req.params.id } });
            if (!current) throw fail(404, 'Transaction not found');
            if (current.status !== 'pending') throw fail(409, 'Only pending transactions can be reviewed');
            if (status === 'completed' && current.metadata?.paymentMode === 'prelaunch_simulated') {
                throw fail(409, 'Pre-launch checkout must use the simulated payment endpoint; admin approval cannot record real funds');
            }

            let course;
            if (status === 'completed' && current.type === 'course_purchase') {
                course = await tx.course.findUnique({ where: { id: current.courseId || current.metadata?.courseId } });
                if (!course) throw fail(404, 'Course for this transaction was not found');
                const priorEnrollment = await tx.enrollment.findUnique({ where: { courseId_userId: { courseId: course.id, userId: current.userId } } });
                if (priorEnrollment) throw fail(409, 'Learner is already enrolled; transaction requires manual review');
            }
            if (status === 'completed' && current.type === 'withdrawal' && !current.metadata?.balanceReserved) {
                const reserved = await tx.user.updateMany({
                    where: { id: current.userId, walletBalance: { gte: current.amount } },
                    data: { walletBalance: { decrement: current.amount } }
                });
                if (reserved.count !== 1) throw fail(400, 'User has insufficient balance');
            }

            const changed = await tx.transaction.updateMany({
                where: { id: current.id, status: 'pending' },
                data: {
                    status,
                    completedAt: status === 'completed' ? new Date() : null,
                    ...(status === 'failed' && req.body.reason
                        ? { metadata: { ...current.metadata, reviewReason: String(req.body.reason).slice(0, 1000) } }
                        : {})
                }
            });
            if (changed.count !== 1) throw fail(409, 'Transaction was already reviewed');

            if (status === 'completed' && current.type === 'course_purchase') {
                await tx.enrollment.create({ data: { courseId: course.id, userId: current.userId } });
                await tx.course.update({ where: { id: course.id }, data: { studentCount: { increment: 1 } } });
                await tx.user.update({ where: { id: course.instructorId }, data: { walletBalance: { increment: current.netAmount } } });
                await tx.financialLedgerEntry.createMany({
                    data: [
                        {
                            userId: current.userId,
                            transactionId: current.id,
                            account: 'course_payment_recorded',
                            entryType: 'course_payment_volume',
                            amount: current.amount,
                            currency: current.currency || 'USD',
                            status: 'verified',
                            isSimulated: false,
                            relatedType: 'course',
                            relatedId: course.id,
                            metadata: { courseTitle: course.title }
                        },
                        {
                            userId: course.instructorId,
                            transactionId: current.id,
                            account: 'instructor_earnings',
                            entryType: 'course_earning',
                            amount: current.netAmount,
                            currency: current.currency || 'USD',
                            status: 'eligible',
                            isSimulated: false,
                            relatedType: 'course',
                            relatedId: course.id,
                            metadata: { courseTitle: course.title }
                        },
                        {
                            transactionId: current.id,
                            account: 'skillhub_revenue',
                            entryType: 'course_commission',
                            amount: current.commission,
                            currency: current.currency || 'USD',
                            status: 'recorded',
                            isSimulated: false,
                            relatedType: 'course',
                            relatedId: course.id,
                            metadata: { courseTitle: course.title }
                        }
                    ]
                });
            }
            if (status === 'completed' && current.type === 'deposit') {
                await tx.user.update({ where: { id: current.userId }, data: { walletBalance: { increment: current.amount } } });
            }
            if (['failed', 'refunded'].includes(status) && current.type === 'withdrawal' && current.metadata?.balanceReserved) {
                await tx.user.update({ where: { id: current.userId }, data: { walletBalance: { increment: current.amount } } });
            }
            return tx.transaction.findUnique({
                where: { id: current.id },
                include: {
                    user: { select: { id: true, name: true, phone: true, email: true } },
                    course: { select: { id: true, title: true } }
                }
            });
        }, { isolationLevel: 'Serializable' });
        const apiTransaction = mapRelation(transaction);
        apiTransaction.payerPhone = transaction.metadata?.payerPhone || transaction.user?.phone || null;
        apiTransaction.itemName = transaction.course?.title || transaction.description || null;
        res.json({ success: true, transaction: apiTransaction });
    } catch (error) {
        res.status(error.statusCode || (error.code === 'P2025' ? 404 : error.code === 'P2002' ? 409 : 500)).json({ success: false, message: error.message });
    }
};

const sendBroadcast = async (req, res) => {
    try {
        const message = String(req.body.message || '').trim();
        const batchSize = Math.min(500, Math.max(1, Number.parseInt(req.body.batchSize, 10) || 100));
        if (!message) return res.status(400).json({ success: false, message: 'Message is required' });
        const where = { status: 'active' };
        if (req.body.role) where.role = req.body.role;
        const users = await prisma.user.findMany({ where, select: { phone: true } });
        let sent = 0;
        for (let i = 0; i < users.length; i += batchSize) {
            const batch = users.slice(i, i + batchSize).filter(user => user.phone);
            await Promise.all(batch.map(user => WhatsAppService.sendToNumber(user.phone, message)));
            sent += batch.length;
        }
        res.json({ success: true, message: `Broadcast sent to ${sent} users`, total: users.length, sent });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getExchangeRates = async (req, res) => {
    try {
        const setting = await prisma.appSetting.findUnique({ where: { key: 'exchangeRates' } });
        res.json({ success: true, rates: setting?.value || null });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateExchangeRates = async (req, res) => {
    try {
        const { rates } = req.body;
        if (!rates || typeof rates !== 'object' || Array.isArray(rates) || !Object.keys(rates).length) {
            return res.status(400).json({ success: false, message: 'A non-empty rates object is required' });
        }
        for (const [currency, entry] of Object.entries(rates)) {
            if (!/^[A-Z]{2,3}$/.test(currency)
                || !entry || typeof entry !== 'object'
                || !Number.isFinite(Number(entry.rate)) || Number(entry.rate) <= 0
                || typeof entry.code !== 'string' || entry.code.length > 8) {
                return res.status(400).json({ success: false, message: `Invalid exchange rate entry for ${currency}` });
            }
        }
        const normalized = Object.fromEntries(Object.entries(rates).map(([currency, entry]) => [
            currency,
            { ...entry, rate: Number(entry.rate), code: entry.code.trim() }
        ]));
        const setting = await prisma.appSetting.upsert({
            where: { key: 'exchangeRates' },
            create: { key: 'exchangeRates', value: normalized },
            update: { value: normalized }
        });
        res.json({ success: true, rates: setting.value, updatedAt: setting.updatedAt });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const DEFAULT_COMMISSION_SETTINGS = {
    course: { instructorSharePercent: 80, skillhubCommissionPercent: 20 },
    freelance: { freelancerSharePercent: 90, skillhubCommissionPercent: 10 }
};

const getCommissionSettings = async (req, res) => {
    try {
        const setting = await prisma.appSetting.findUnique({ where: { key: 'commissionSettings' } });
        res.json({ success: true, settings: setting?.value || DEFAULT_COMMISSION_SETTINGS });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateCommissionSettings = async (req, res) => {
    const normalizeSplit = (split, leftKey, label) => {
        if (!split || typeof split !== 'object') throw fail(400, `${label} commission split is required`);
        const left = Number(split[leftKey]);
        const commission = Number(split.skillhubCommissionPercent);
        if (!Number.isFinite(left) || !Number.isFinite(commission)
            || left < 0 || left > 100 || commission < 0 || commission > 100
            || Math.abs(left + commission - 100) > 0.0001) {
            throw fail(400, `${label} shares must be valid percentages that total 100`);
        }
        return { [leftKey]: left, skillhubCommissionPercent: commission };
    };

    try {
        const settings = {
            course: normalizeSplit(req.body.course, 'instructorSharePercent', 'Course'),
            freelance: normalizeSplit(req.body.freelance, 'freelancerSharePercent', 'Freelance')
        };
        const saved = await prisma.appSetting.upsert({
            where: { key: 'commissionSettings' },
            create: { key: 'commissionSettings', value: settings },
            update: { value: settings }
        });
        res.json({ success: true, settings: saved.value, updatedAt: saved.updatedAt });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

const getAdminActivityLogs = async (req, res) => {
    try {
        const take = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
        const logs = await prisma.adminAuditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take,
            include: { adminUser: { select: { id: true, name: true, email: true } } }
        });
        res.json({ success: true, logs: logs.map(log => ({ ...log, _id: log.id, id: log.id })) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const validBusinessStatuses = ['new', 'in_progress', 'quoted', 'closed', 'rejected'];
const validSupportStatuses = ['new', 'open', 'pending_customer', 'resolved', 'closed'];
const validReportStatuses = ['new', 'reviewing', 'investigating', 'resolved', 'closed', 'rejected'];

const getBusinessInquiries = async (req, res) => {
    try {
        const page = pageValue(req.query.page);
        const limit = limitValue(req.query.limit);
        const where = { subject: 'business' };
        if (req.query.status) {
            const requested = String(req.query.status).trim();
            if (!validBusinessStatuses.includes(requested)) {
                return res.status(400).json({ success: false, message: 'Invalid inquiry status' });
            }
            where.status = requested;
        }
        const [inquiries, total] = await prisma.$transaction([
            prisma.contactMessage.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: (page - 1) * limit
            }),
            prisma.contactMessage.count({ where })
        ]);
        res.json({
            success: true,
            inquiries: inquiries.map(inquiry => ({ ...inquiry, _id: inquiry.id, id: inquiry.id })),
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateBusinessInquiryStatus = async (req, res) => {
    try {
        const inquiryId = String(req.params.id || '').trim();
        const nextStatus = String(req.body.status || '').trim();
        if (!inquiryId) return res.status(400).json({ success: false, message: 'Inquiry id is required' });
        if (!validBusinessStatuses.includes(nextStatus)) {
            return res.status(400).json({ success: false, message: 'Status must be one of: new, in_progress, quoted, closed, rejected' });
        }

        const existing = await prisma.contactMessage.findUnique({ where: { id: inquiryId } });
        if (!existing) return res.status(404).json({ success: false, message: 'Business inquiry not found' });
        if (existing.subject !== 'business') return res.status(400).json({ success: false, message: 'This record is not a business inquiry' });

        const updated = await prisma.contactMessage.update({
            where: { id: inquiryId },
            data: { status: nextStatus }
        });
        res.json({ success: true, inquiry: { ...updated, _id: updated.id, id: updated.id } });
    } catch (error) {
        const statusCode = error?.code === 'P2025' ? 404 : 500;
        res.status(statusCode).json({ success: false, message: error.message });
    }
};

const getSupportTickets = async (req, res) => {
    try {
        const page = pageValue(req.query.page);
        const limit = limitValue(req.query.limit);
        const where = { subject: 'support' };
        if (req.query.status) {
            const requested = String(req.query.status).trim();
            if (!validSupportStatuses.includes(requested)) {
                return res.status(400).json({ success: false, message: 'Invalid support ticket status' });
            }
            where.status = requested;
        }
        const [tickets, total] = await prisma.$transaction([
            prisma.contactMessage.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: (page - 1) * limit
            }),
            prisma.contactMessage.count({ where })
        ]);
        res.json({
            success: true,
            tickets: tickets.map(ticket => ({ ...ticket, _id: ticket.id, id: ticket.id })),
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateSupportTicketStatus = async (req, res) => {
    try {
        const ticketId = String(req.params.id || '').trim();
        const nextStatus = String(req.body.status || '').trim();
        if (!ticketId) return res.status(400).json({ success: false, message: 'Ticket id is required' });
        if (!validSupportStatuses.includes(nextStatus)) {
            return res.status(400).json({ success: false, message: 'Status must be one of: new, open, pending_customer, resolved, closed' });
        }

        const existing = await prisma.contactMessage.findUnique({ where: { id: ticketId } });
        if (!existing) return res.status(404).json({ success: false, message: 'Support ticket not found' });
        if (existing.subject !== 'support') return res.status(400).json({ success: false, message: 'This record is not a support ticket' });

        const updated = await prisma.contactMessage.update({
            where: { id: ticketId },
            data: { status: nextStatus }
        });
        res.json({ success: true, ticket: { ...updated, _id: updated.id, id: updated.id } });
    } catch (error) {
        const statusCode = error?.code === 'P2025' ? 404 : 500;
        res.status(statusCode).json({ success: false, message: error.message });
    }
};

const getReportsComplaints = async (req, res) => {
    try {
        const page = pageValue(req.query.page);
        const limit = limitValue(req.query.limit);
        const where = { OR: [{ subject: 'report' }, { subject: 'complaint' }] };
        if (req.query.status) {
            const requested = String(req.query.status).trim();
            if (!validReportStatuses.includes(requested)) {
                return res.status(400).json({ success: false, message: 'Invalid report or complaint status' });
            }
            where.status = requested;
        }
        const [items, total] = await prisma.$transaction([
            prisma.contactMessage.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: limit,
                skip: (page - 1) * limit
            }),
            prisma.contactMessage.count({ where })
        ]);
        res.json({
            success: true,
            reports: items.map(item => ({ ...item, _id: item.id, id: item.id })),
            total,
            totalPages: Math.ceil(total / limit),
            currentPage: page
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAdminNotifications = async (req, res) => {
    try {
        const setting = await prisma.appSetting.findUnique({ where: { key: 'adminNotifications' } });
        const items = Array.isArray(setting?.value) ? setting.value : [];
        const sorted = [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        res.json({ success: true, notifications: sorted.map(item => ({ ...item, _id: item.id, id: item.id })) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createAdminNotification = async (req, res) => {
    try {
        const title = String(req.body.title || '').trim();
        const message = String(req.body.message || '').trim();
        const type = String(req.body.type || 'info').trim();
        const audience = String(req.body.audience || 'all').trim();
        const priority = String(req.body.priority || 'normal').trim();
        if (!title || !message) {
            return res.status(400).json({ success: false, message: 'Title and message are required' });
        }
        const setting = await prisma.appSetting.upsert({
            where: { key: 'adminNotifications' },
            create: { key: 'adminNotifications', value: [] },
            update: { value: (await prisma.appSetting.findUnique({ where: { key: 'adminNotifications' } })?.value) || [] }
        });
        const current = Array.isArray(setting.value) ? setting.value : [];
        const record = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            title,
            message,
            type: ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info',
            audience: ['all', 'users', 'admins', 'instructors', 'freelancers'].includes(audience) ? audience : 'all',
            priority: ['low', 'normal', 'high'].includes(priority) ? priority : 'normal',
            read: false,
            createdAt: new Date().toISOString(),
            createdBy: req.user?.name || 'Admin'
        };
        const updated = [record, ...current].slice(0, 100);
        const saved = await prisma.appSetting.upsert({
            where: { key: 'adminNotifications' },
            create: { key: 'adminNotifications', value: updated },
            update: { value: updated }
        });
        res.status(201).json({ success: true, notification: { ...record, _id: record.id, id: record.id }, notifications: saved.value });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const markAdminNotificationRead = async (req, res) => {
    try {
        const setting = await prisma.appSetting.findUnique({ where: { key: 'adminNotifications' } });
        const current = Array.isArray(setting?.value) ? setting.value : [];
        const updated = current.map(item => item.id === req.params.id ? { ...item, read: true } : item);
        const saved = await prisma.appSetting.upsert({
            where: { key: 'adminNotifications' },
            create: { key: 'adminNotifications', value: updated },
            update: { value: updated }
        });
        res.json({ success: true, notifications: saved.value });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateReportComplaintStatus = async (req, res) => {
    try {
        const itemId = String(req.params.id || '').trim();
        const nextStatus = String(req.body.status || '').trim();
        if (!itemId) return res.status(400).json({ success: false, message: 'Report or complaint id is required' });
        if (!validReportStatuses.includes(nextStatus)) {
            return res.status(400).json({ success: false, message: 'Status must be one of: new, reviewing, investigating, resolved, closed, rejected' });
        }

        const existing = await prisma.contactMessage.findUnique({ where: { id: itemId } });
        if (!existing) return res.status(404).json({ success: false, message: 'Report or complaint not found' });
        if (!['report', 'complaint'].includes(existing.subject)) {
            return res.status(400).json({ success: false, message: 'This record is not a report or complaint' });
        }

        const updated = await prisma.contactMessage.update({
            where: { id: itemId },
            data: { status: nextStatus }
        });
        res.json({ success: true, report: { ...updated, _id: updated.id, id: updated.id } });
    } catch (error) {
        const statusCode = error?.code === 'P2025' ? 404 : 500;
        res.status(statusCode).json({ success: false, message: error.message });
    }
};

const searchAdminRecords = async (req, res) => {
    try {
        const q = String(req.query.q || '').trim();
        if (!q) return res.json({ success: true, results: [] });
        const [users, courses, transactions] = await Promise.all([
            prisma.user.findMany({
                where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { phone: { contains: q, mode: 'insensitive' } }] },
                take: 8,
                select: { id: true, name: true, email: true, role: true, status: true }
            }),
            prisma.course.findMany({
                where: { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] },
                take: 8,
                select: { id: true, title: true, status: true, category: true }
            }),
            prisma.transaction.findMany({
                where: { OR: [{ reference: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] },
                take: 8,
                select: { id: true, reference: true, type: true, amount: true, currency: true, status: true }
            })
        ]);
        res.json({ success: true, results: { users, courses, transactions } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getFinancialReport = async (req, res) => {
    try {
        const where = {};
        if (req.query.type) where.type = String(req.query.type).trim();
        if (req.query.status) where.status = String(req.query.status).trim();
        if (req.query.currency) where.currency = String(req.query.currency).trim().toUpperCase();
        if (req.query.simulated === 'true') where.isSimulated = true;
        if (req.query.simulated === 'false') where.isSimulated = false;
        if (req.query.from || req.query.to) {
            const createdAt = {};
            if (req.query.from) {
                createdAt.gte = new Date(req.query.from);
                if (Number.isNaN(createdAt.gte.getTime())) return res.status(400).json({ success: false, message: 'Invalid from date' });
            }
            if (req.query.to) {
                createdAt.lte = new Date(req.query.to);
                if (Number.isNaN(createdAt.lte.getTime())) return res.status(400).json({ success: false, message: 'Invalid to date' });
            }
            where.createdAt = createdAt;
        }

        const completedCourseWhere = { ...where, type: 'course_purchase', status: 'completed' };
        const freelanceWhere = {};
        if (req.query.status) freelanceWhere.status = String(req.query.status).trim();
        if (req.query.currency) freelanceWhere.currency = String(req.query.currency).trim().toUpperCase();
        if (req.query.from || req.query.to) {
            freelanceWhere.reportedAt = {};
            if (req.query.from) freelanceWhere.reportedAt.gte = new Date(req.query.from);
            if (req.query.to) freelanceWhere.reportedAt.lte = new Date(req.query.to);
        }
        const includeFreelanceReports = (!req.query.type || req.query.type === 'freelance_hire') && req.query.simulated !== 'true';
        const [transactionCount, actualCourses, simulatedCourses, pendingCourses, withdrawals, recentTransactions, freelancePayments] = await Promise.all([
            prisma.transaction.count({ where }),
            prisma.transaction.groupBy({ by: ['currency'], where: { ...completedCourseWhere, isSimulated: false }, _sum: { amount: true, commission: true, netAmount: true } }),
            prisma.transaction.groupBy({ by: ['currency'], where: { ...completedCourseWhere, isSimulated: true }, _sum: { amount: true, commission: true, netAmount: true } }),
            prisma.transaction.groupBy({ by: ['currency'], where: { ...where, type: 'course_purchase', status: 'pending' }, _sum: { amount: true, netAmount: true }, _count: { _all: true } }),
            prisma.transaction.groupBy({ by: ['status', 'currency'], where: { ...where, type: 'withdrawal' }, _count: { _all: true }, _sum: { amount: true } }),
            prisma.transaction.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                take: Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25)),
                select: { id: true, type: true, amount: true, currency: true, commission: true, netAmount: true, status: true, isSimulated: true, paymentMethod: true, reference: true, createdAt: true }
            }),
            includeFreelanceReports
                ? prisma.freelancePaymentReport.groupBy({ by: ['status', 'currency'], where: freelanceWhere, _count: { _all: true }, _sum: { amount: true, commissionAmount: true, freelancerNetAmount: true } })
                : Promise.resolve([])
        ]);
        const currencyTotals = (groups, fields) => groups.map(group => {
            const result = { currency: group.currency || 'USD' };
            fields.forEach(([field, source]) => {
                result[field] = field === 'count'
                    ? group._count._all
                    : Number(group._sum[source] || 0);
            });
            return result;
        });
        res.json({
            success: true,
            filters: { from: req.query.from || null, to: req.query.to || null, type: req.query.type || null, status: req.query.status || null, currency: req.query.currency || null, simulated: req.query.simulated || null },
            report: {
                transactionCount,
                coursePayments: {
                    recorded: currencyTotals(actualCourses, [['volume', 'amount'], ['skillhubCommission', 'commission'], ['instructorEarnings', 'netAmount']]),
                    simulated: currencyTotals(simulatedCourses, [['volume', 'amount'], ['skillhubCommission', 'commission'], ['instructorEarnings', 'netAmount']])
                },
                pendingCoursePayments: currencyTotals(pendingCourses, [['count', null], ['volume', 'amount'], ['pendingInstructorEarnings', 'netAmount']]),
                withdrawals: withdrawals.map(item => ({ status: item.status, currency: item.currency || 'USD', count: item._count._all, amount: Number(item._sum.amount || 0) })),
                externalFreelancePayments: freelancePayments.map(item => ({
                    status: item.status,
                    currency: item.currency,
                    count: item._count._all,
                    reportedVolume: Number(item._sum.amount || 0),
                    freelancerNetReported: Number(item._sum.freelancerNetAmount || 0),
                    skillhubCommissionOutstanding: Number(item._sum.commissionAmount || 0),
                    cashReceivedBySkillhub: 0
                }))
            },
            transactions: mapRelation(recentTransactions)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getStats,
    getPendingApprovals,
    approveUser,
    rejectUser,
    approveCourse,
    rejectCourse,
    setCourseFeatured,
    getAllUsers,
    getAllTransactions,
    updateTransactionStatus,
    sendBroadcast,
    getExchangeRates,
    updateExchangeRates,
    getCommissionSettings,
    updateCommissionSettings,
    getFinancialReport,
    getAdminRoleCatalog,
    getAdminRoleUsers,
    updateAdminRolePermissions,
    getAdminActivityLogs,
    searchAdminRecords,
    getBusinessInquiries,
    updateBusinessInquiryStatus,
    getSupportTickets,
    updateSupportTicketStatus,
    getReportsComplaints,
    updateReportComplaintStatus,
    getAdminNotifications,
    createAdminNotification,
    markAdminNotificationRead
};
