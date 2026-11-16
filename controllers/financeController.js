const crypto = require('crypto');
const prisma = require('../utils/prisma');

const reference = prefix => `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const reservedWithdrawalStatuses = ['requested', 'under_review', 'approved', 'processing', 'completed'];
const maskDestination = value => {
    const text = String(value || '').trim();
    if (!text) return null;
    return `••••${text.slice(-4)}`;
};

const getMyFinancialSummary = async (req, res) => {
    try {
        if (!['instructor', 'freelancer'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Earnings are available to instructors and freelancers only' });
        }
        const where = { userId: req.user.id };
        if (req.query.currency) where.currency = String(req.query.currency).trim().toUpperCase();
        if (req.query.status) where.status = String(req.query.status).trim();
        if (req.query.from || req.query.to) {
            where.createdAt = {};
            if (req.query.from) {
                where.createdAt.gte = new Date(req.query.from);
                if (Number.isNaN(where.createdAt.gte.getTime())) return res.status(400).json({ success: false, message: 'Invalid from date' });
            }
            if (req.query.to) {
                where.createdAt.lte = new Date(req.query.to);
                if (Number.isNaN(where.createdAt.lte.getTime())) return res.status(400).json({ success: false, message: 'Invalid to date' });
            }
        }
        const [entries, withdrawalRequests] = await Promise.all([
            prisma.financialLedgerEntry.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 }),
            prisma.withdrawalRequest.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 })
        ]);
        const currencies = new Set(entries.map(entry => entry.currency));
        withdrawalRequests.forEach(request => currencies.add(request.currency));
        const totals = Array.from(currencies).sort().map(currency => {
            const currencyEntries = entries.filter(entry => entry.currency === currency);
            const eligibleAccount = req.user.role === 'instructor' ? 'instructor_earnings' : 'freelancer_earnings';
            const eligibleEarnings = currencyEntries
                .filter(entry => entry.account === eligibleAccount && entry.status === 'eligible' && !entry.isSimulated)
                .reduce((sum, entry) => sum + Number(entry.amount), 0);
            const externalReported = currencyEntries
                .filter(entry => entry.account === 'freelancer_external_payment_volume')
                .reduce((sum, entry) => sum + Number(entry.amount), 0);
            const externalFreelancerNet = currencyEntries
                .filter(entry => entry.account === 'freelancer_external_earnings')
                .reduce((sum, entry) => sum + Number(entry.amount), 0);
            const outstandingFreelanceCommission = currencyEntries
                .filter(entry => entry.account === 'skillhub_commission_receivable' && entry.status === 'outstanding')
                .reduce((sum, entry) => sum + Number(entry.amount), 0);
            const simulatedEarnings = currencyEntries
                .filter(entry => entry.isSimulated && /earning/.test(entry.entryType))
                .reduce((sum, entry) => sum + Number(entry.amount), 0);
            const reserved = withdrawalRequests
                .filter(request => request.currency === currency && reservedWithdrawalStatuses.includes(request.status))
                .reduce((sum, request) => sum + Number(request.amount), 0);
            return {
                currency,
                eligibleRecordedEarnings: eligibleEarnings,
                reservedWithdrawalRequests: reserved,
                availableForRequest: Math.max(0, eligibleEarnings - reserved),
                verifiedExternalPayments: externalReported,
                verifiedExternalFreelancerNet: externalFreelancerNet,
                outstandingFreelanceCommission,
                simulatedEarnings
            };
        });
        res.json({ success: true, mode: 'prelaunch', totals, entries, withdrawalRequests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const requestWithdrawal = async (req, res) => {
    try {
        if (!['instructor', 'freelancer'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Only instructors and freelancers may request withdrawals' });
        }
        const amount = Number(req.body.amount);
        const currency = String(req.body.currency || 'USD').trim().toUpperCase();
        const payoutMethod = String(req.body.payoutMethod || '').trim();
        const allowedMethods = ['telebirr', 'cbe_birr', 'bank_transfer', 'mobile_money', 'other'];
        if (!Number.isFinite(amount) || amount < 5) return res.status(400).json({ success: false, message: 'Minimum withdrawal request is 5.00' });
        if (!/^[A-Z]{3}$/.test(currency)) return res.status(400).json({ success: false, message: 'Currency must be a three-letter code' });
        if (!allowedMethods.includes(payoutMethod)) return res.status(400).json({ success: false, message: 'Select a supported payout preference' });
        if (req.body.destination && String(req.body.destination).length > 120) return res.status(400).json({ success: false, message: 'Payout destination hint is too long' });

        const account = req.user.role === 'instructor' ? 'instructor_earnings' : 'freelancer_earnings';
        const created = await prisma.$transaction(async tx => {
            const earnings = await tx.financialLedgerEntry.aggregate({
                where: { userId: req.user.id, currency, account, status: 'eligible', isSimulated: false },
                _sum: { amount: true }
            });
            const held = await tx.withdrawalRequest.aggregate({
                where: { userId: req.user.id, currency, status: { in: reservedWithdrawalStatuses } },
                _sum: { amount: true }
            });
            const eligible = Number(earnings._sum.amount || 0) - Number(held._sum.amount || 0);
            if (amount > eligible) throw fail(400, 'Requested amount exceeds recorded eligible earnings');

            const withdrawal = await tx.withdrawalRequest.create({
                data: {
                    reference: reference('WDR'),
                    userId: req.user.id,
                    amount: Math.round(amount * 100) / 100,
                    currency,
                    payoutMethod,
                    destinationMasked: maskDestination(req.body.destination),
                    status: 'requested',
                    isSimulated: true
                }
            });
            await tx.financialLedgerEntry.create({
                data: {
                    userId: req.user.id,
                    account: 'withdrawal_reserve',
                    entryType: 'withdrawal_requested',
                    amount: withdrawal.amount,
                    currency,
                    status: 'requested',
                    isSimulated: true,
                    relatedType: 'withdrawal_request',
                    relatedId: withdrawal.id,
                    metadata: { reference: withdrawal.reference, payoutMethod }
                }
            });
            return withdrawal;
        }, { isolationLevel: 'Serializable' });
        res.status(201).json({
            success: true,
            message: 'Withdrawal request recorded for internal review. No transfer was initiated.',
            withdrawal: created
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

const createRefundRequest = async (req, res) => {
    try {
        const transactionId = String(req.body.transactionId || '').trim();
        const reason = String(req.body.reason || '').trim();
        const description = String(req.body.description || '').trim();
        if (!transactionId || !reason) return res.status(400).json({ success: false, message: 'Transaction and refund reason are required' });
        if (reason.length > 120 || description.length > 2000) return res.status(400).json({ success: false, message: 'Refund request details are too long' });

        const transaction = await prisma.transaction.findFirst({ where: { id: transactionId, userId: req.user.id } });
        if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });
        if (transaction.type !== 'course_purchase' || transaction.status !== 'completed') {
            return res.status(400).json({ success: false, message: 'Only completed course purchases can be submitted for refund review' });
        }
        const active = await prisma.refundRequest.findFirst({
            where: { transactionId, status: { in: ['requested', 'under_review', 'needs_information', 'approved_recorded'] } }
        });
        if (active) return res.status(409).json({ success: false, message: 'A refund request already exists for this transaction' });
        const refund = await prisma.refundRequest.create({
            data: { reference: reference('RFD'), transactionId, userId: req.user.id, reason, description: description || null }
        });
        res.status(201).json({ success: true, message: 'Refund request recorded for review. Approval does not mean money has been transferred.', refund });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMyRefundRequests = async (req, res) => {
    try {
        const refunds = await prisma.refundRequest.findMany({
            where: { userId: req.user.id },
            include: { transaction: { select: { reference: true, amount: true, currency: true, isSimulated: true, course: { select: { title: true } } } } },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, refunds });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createFreelanceProject = async (req, res) => {
    try {
        if (req.user.role !== 'client') return res.status(403).json({ success: false, message: 'Client accounts only' });
        const freelancerProfileId = String(req.body.freelancerId || '').trim();
        const title = String(req.body.title || '').trim();
        const description = String(req.body.description || '').trim();
        const budget = Number(req.body.budget);
        const currency = String(req.body.currency || 'USD').trim().toUpperCase();
        if (!freelancerProfileId || !title || !description || !Number.isFinite(budget) || budget <= 0) {
            return res.status(400).json({ success: false, message: 'Freelancer, title, description, and a positive budget are required' });
        }
        if (title.length > 160 || description.length > 10000 || !/^[A-Z]{3}$/.test(currency)) {
            return res.status(400).json({ success: false, message: 'Project details or currency are invalid' });
        }
        const freelancer = await prisma.freelancer.findFirst({
            where: { id: freelancerProfileId, status: 'approved', user: { is: { status: 'active' } } },
            select: { userId: true }
        });
        if (!freelancer) return res.status(404).json({ success: false, message: 'Approved freelancer not found' });
        if (freelancer.userId === req.user.id) return res.status(400).json({ success: false, message: 'You cannot create a project with yourself' });

        const setting = await prisma.appSetting.findUnique({ where: { key: 'commissionSettings' } });
        const commissionPercent = Number(setting?.value?.freelance?.skillhubCommissionPercent ?? 10);
        if (!Number.isFinite(commissionPercent) || commissionPercent < 0 || commissionPercent > 100) {
            return res.status(500).json({ success: false, message: 'Freelance commission settings are invalid' });
        }
        const commissionAmount = money(budget * commissionPercent / 100);
        const project = await prisma.freelanceProject.create({
            data: {
                reference: reference('PRJ'),
                clientId: req.user.id,
                freelancerId: freelancer.userId,
                title,
                description,
                budget: money(budget),
                currency,
                commissionPercent,
                commissionAmount,
                freelancerNetAmount: money(budget - commissionAmount),
                paymentArrangement: 'direct_external',
                milestones: Array.isArray(req.body.milestones) ? req.body.milestones.slice(0, 40) : [],
                status: 'agreed',
                completionStatus: 'not_started'
            },
            include: { client: { select: { id: true, name: true } }, freelancer: { select: { id: true, name: true } } }
        });
        res.status(201).json({ success: true, project, message: 'Project agreement recorded. Payments are made directly between client and freelancer.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMyFreelanceProjects = async (req, res) => {
    try {
        if (!['client', 'freelancer', 'admin'].includes(req.user.role)) return res.status(403).json({ success: false, message: 'Project access denied' });
        const where = req.user.role === 'admin'
            ? {}
            : { OR: [{ clientId: req.user.id }, { freelancerId: req.user.id }] };
        const projects = await prisma.freelanceProject.findMany({
            where,
            include: {
                client: { select: { id: true, name: true } },
                freelancer: { select: { id: true, name: true } },
                paymentReports: { orderBy: { reportedAt: 'desc' } }
            },
            orderBy: { updatedAt: 'desc' },
            take: 100
        });
        res.json({ success: true, projects });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateFreelanceProjectStatus = async (req, res) => {
    try {
        const project = await prisma.freelanceProject.findUnique({ where: { id: req.params.id } });
        if (!project) return res.status(404).json({ success: false, message: 'Project not found' });
        if (![project.clientId, project.freelancerId].includes(req.user.id)) return res.status(404).json({ success: false, message: 'Project not found' });
        const nextStatus = String(req.body.status || '').trim();
        let data;
        if (req.user.id === project.freelancerId && nextStatus === 'delivered') {
            data = { status: 'delivered', completionStatus: 'delivered' };
        } else if (req.user.id === project.clientId && nextStatus === 'completed' && project.completionStatus === 'delivered') {
            data = { status: 'completed', completionStatus: 'approved' };
        } else if (req.user.id === project.clientId && nextStatus === 'cancelled' && !['completed', 'cancelled'].includes(project.status)) {
            data = { status: 'cancelled', completionStatus: 'cancelled' };
        } else {
            return res.status(400).json({ success: false, message: 'That project status change is not allowed' });
        }
        const updated = await prisma.freelanceProject.update({ where: { id: project.id }, data });
        res.json({ success: true, project: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createFreelancePaymentReport = async (req, res) => {
    try {
        const project = await prisma.freelanceProject.findUnique({ where: { id: req.params.id } });
        if (!project || project.freelancerId !== req.user.id) return res.status(404).json({ success: false, message: 'Project not found' });
        if (project.completionStatus !== 'approved') return res.status(409).json({ success: false, message: 'The client must approve the delivered work before payment can be reported' });
        const amount = Number(req.body.amount);
        const currency = String(req.body.currency || project.currency).trim().toUpperCase();
        const paymentMethodDescription = String(req.body.paymentMethodDescription || '').trim();
        const paymentDate = new Date(req.body.paymentDate);
        if (!Number.isFinite(amount) || amount <= 0 || !paymentMethodDescription || Number.isNaN(paymentDate.getTime())) {
            return res.status(400).json({ success: false, message: 'Amount, payment date, and payment method description are required' });
        }
        if (currency !== project.currency) return res.status(400).json({ success: false, message: 'Reported payment currency must match the project agreement' });
        if (paymentMethodDescription.length > 100 || String(req.body.transactionReference || '').length > 120 || String(req.body.evidence || '').length > 1400000) {
            return res.status(400).json({ success: false, message: 'Payment report details exceed the allowed size' });
        }
        const alreadyReported = await prisma.freelancePaymentReport.aggregate({
            where: { projectId: project.id, status: { notIn: ['rejected'] } },
            _sum: { amount: true }
        });
        const remainingBudget = Math.max(0, project.budget - Number(alreadyReported._sum.amount || 0));
        if (amount > remainingBudget) return res.status(400).json({ success: false, message: 'Reported payment exceeds the remaining project budget' });
        const commissionAmount = money(amount * project.commissionPercent / 100);
        const paymentReport = await prisma.freelancePaymentReport.create({
            data: {
                reference: reference('FPR'),
                projectId: project.id,
                reporterId: req.user.id,
                amount: money(amount),
                currency,
                paymentDate,
                paymentMethodDescription,
                transactionReference: String(req.body.transactionReference || '').trim() || null,
                evidence: String(req.body.evidence || '').trim() || null,
                commissionPercent: project.commissionPercent,
                commissionAmount,
                freelancerNetAmount: money(amount - commissionAmount),
                status: 'awaiting_client'
            }
        });
        res.status(201).json({
            success: true,
            paymentReport,
            notice: 'This is a freelancer-reported external payment. It is not money received by SkillHub and is not yet verified.'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const respondToFreelancePaymentReport = async (req, res) => {
    try {
        const report = await prisma.freelancePaymentReport.findUnique({
            where: { id: req.params.reportId },
            include: { project: { select: { clientId: true } } }
        });
        if (!report || report.project.clientId !== req.user.id) return res.status(404).json({ success: false, message: 'Payment report not found' });
        if (report.status !== 'awaiting_client') return res.status(409).json({ success: false, message: 'This report is no longer awaiting client confirmation' });
        const decision = req.body.decision;
        if (!['confirm', 'dispute'].includes(decision)) return res.status(400).json({ success: false, message: 'Choose confirm or dispute' });
        const response = String(req.body.response || '').trim();
        if (decision === 'dispute' && !response) return res.status(400).json({ success: false, message: 'A dispute explanation is required' });
        const updated = await prisma.freelancePaymentReport.update({
            where: { id: report.id },
            data: { status: decision === 'confirm' ? 'client_confirmed' : 'disputed', clientResponse: response || null }
        });
        res.json({ success: true, paymentReport: updated, notice: 'Client confirmation records an external payment; it does not mean SkillHub received the funds.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getProjectPaymentReports = async (req, res) => {
    try {
        const project = await prisma.freelanceProject.findUnique({ where: { id: req.params.id } });
        if (!project || ![project.clientId, project.freelancerId].includes(req.user.id)) return res.status(404).json({ success: false, message: 'Project not found' });
        const reports = await prisma.freelancePaymentReport.findMany({ where: { projectId: project.id }, orderBy: { reportedAt: 'desc' } });
        res.json({ success: true, paymentReports: reports });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAdminWithdrawalRequests = async (req, res) => {
    try {
        const where = {};
        if (req.query.status) where.status = String(req.query.status);
        if (req.query.currency) where.currency = String(req.query.currency).toUpperCase();
        const requests = await prisma.withdrawalRequest.findMany({
            where,
            include: { user: { select: { id: true, name: true, email: true, role: true } } },
            orderBy: { createdAt: 'desc' },
            take: 200
        });
        res.json({ success: true, withdrawals: requests });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const reviewWithdrawalRequest = async (req, res) => {
    try {
        const status = String(req.body.status || '');
        const allowed = ['under_review', 'approved', 'rejected', 'needs_information', 'flagged', 'processing', 'completed', 'failed', 'reversed'];
        if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid withdrawal status' });
        const reason = String(req.body.reason || '').trim();
        if (status === 'rejected' && !reason) return res.status(400).json({ success: false, message: 'A rejection reason is required' });
        const result = await prisma.$transaction(async tx => {
            const current = await tx.withdrawalRequest.findUnique({ where: { id: req.params.id } });
            if (!current) throw fail(404, 'Withdrawal request not found');
            if (['rejected', 'failed', 'reversed', 'completed'].includes(current.status)) throw fail(409, 'Withdrawal request has already been resolved');
            const updated = await tx.withdrawalRequest.update({
                where: { id: current.id },
                data: {
                    status,
                    decisionReason: reason || current.decisionReason,
                    adminNote: typeof req.body.note === 'string' ? req.body.note.slice(0, 2000) : current.adminNote,
                    payoutReference: typeof req.body.payoutReference === 'string' ? req.body.payoutReference.slice(0, 120) : current.payoutReference,
                    completedAt: status === 'completed' ? new Date() : current.completedAt
                }
            });
            if (status === 'completed') {
                await tx.financialLedgerEntry.create({
                    data: {
                        userId: current.userId,
                        account: 'payout_simulation',
                        entryType: 'simulated_withdrawal_completion',
                        amount: current.amount,
                        currency: current.currency,
                        status: 'simulated',
                        isSimulated: true,
                        relatedType: 'withdrawal_request',
                        relatedId: current.id,
                        metadata: { reference: current.reference, note: 'No payout transfer was initiated.' }
                    }
                });
            } else if (['rejected', 'failed', 'reversed'].includes(status)) {
                await tx.financialLedgerEntry.create({
                    data: {
                        userId: current.userId,
                        account: 'withdrawal_reserve',
                        entryType: 'withdrawal_reservation_released',
                        amount: current.amount,
                        currency: current.currency,
                        status,
                        isSimulated: true,
                        relatedType: 'withdrawal_request',
                        relatedId: current.id,
                        metadata: { reference: current.reference, reason: reason || null }
                    }
                });
            }
            return updated;
        }, { isolationLevel: 'Serializable' });
        res.json({ success: true, withdrawal: result, notice: status === 'completed' ? 'Recorded as a simulated payout only. No money was transferred.' : undefined });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

const getAdminRefundRequests = async (req, res) => {
    try {
        const where = {};
        if (req.query.status) where.status = String(req.query.status);
        const refunds = await prisma.refundRequest.findMany({
            where,
            include: {
                user: { select: { id: true, name: true, email: true } },
                transaction: { select: { id: true, reference: true, amount: true, currency: true, isSimulated: true, course: { select: { title: true } } } }
            },
            orderBy: { createdAt: 'desc' },
            take: 200
        });
        res.json({ success: true, refunds });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const reviewRefundRequest = async (req, res) => {
    try {
        const status = String(req.body.status || '');
        const allowed = ['under_review', 'needs_information', 'approved_recorded', 'rejected'];
        if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid refund-review status' });
        const reason = String(req.body.reason || '').trim();
        if (status === 'rejected' && !reason) return res.status(400).json({ success: false, message: 'A rejection reason is required' });
        const result = await prisma.$transaction(async tx => {
            const current = await tx.refundRequest.findUnique({ where: { id: req.params.id }, include: { transaction: true } });
            if (!current) throw fail(404, 'Refund request not found');
            if (['approved_recorded', 'rejected'].includes(current.status)) throw fail(409, 'Refund request has already been resolved');
            const updated = await tx.refundRequest.update({
                where: { id: current.id },
                data: {
                    status,
                    adminNote: [reason, String(req.body.note || '').trim()].filter(Boolean).join('\n').slice(0, 2000) || null,
                    reviewedAt: ['approved_recorded', 'rejected'].includes(status) ? new Date() : null
                }
            });
            if (status === 'approved_recorded') {
                await tx.financialLedgerEntry.create({
                    data: {
                        userId: current.userId,
                        transactionId: current.transactionId,
                        account: 'course_refund_adjustment',
                        entryType: 'refund_recorded_adjustment',
                        amount: -Number(current.transaction.amount),
                        currency: current.transaction.currency || 'USD',
                        status: current.transaction.isSimulated ? 'simulated_refund_recorded' : 'refund_recorded',
                        isSimulated: current.transaction.isSimulated,
                        relatedType: 'refund_request',
                        relatedId: current.id,
                        metadata: { reference: current.reference, note: 'This records a refund decision; it does not execute a transfer.' }
                    }
                });
            }
            return updated;
        }, { isolationLevel: 'Serializable' });
        res.json({ success: true, refund: result, notice: status === 'approved_recorded' ? 'Refund decision recorded. No funds were transferred.' : undefined });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

const getAdminFreelancePaymentReports = async (req, res) => {
    try {
        const where = {};
        if (req.query.status) where.status = String(req.query.status);
        if (req.query.currency) where.currency = String(req.query.currency).toUpperCase();
        const reports = await prisma.freelancePaymentReport.findMany({
            where,
            include: {
                project: { select: { id: true, reference: true, title: true, clientId: true, freelancerId: true } },
                reporter: { select: { id: true, name: true, email: true } }
            },
            orderBy: { reportedAt: 'desc' },
            take: 200
        });
        res.json({ success: true, reports, notice: 'These are client-to-freelancer external payments, not SkillHub cash.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const reviewFreelancePaymentReport = async (req, res) => {
    try {
        const status = String(req.body.status || '');
        const allowed = ['verified_external', 'needs_evidence', 'flagged', 'rejected'];
        if (!allowed.includes(status)) return res.status(400).json({ success: false, message: 'Invalid freelance payment review status' });
        const note = String(req.body.note || '').trim();
        if (['needs_evidence', 'flagged', 'rejected'].includes(status) && !note) return res.status(400).json({ success: false, message: 'A review note is required' });
        const result = await prisma.$transaction(async tx => {
            const report = await tx.freelancePaymentReport.findUnique({ where: { id: req.params.id }, include: { project: true } });
            if (!report) throw fail(404, 'Freelance payment report not found');
            if (report.status === 'verified_external' || report.status === 'rejected') throw fail(409, 'Payment report has already been resolved');
            if (status === 'verified_external' && report.status !== 'client_confirmed') {
                throw fail(409, 'Client confirmation is required before verifying an external payment');
            }
            const updated = await tx.freelancePaymentReport.update({
                where: { id: report.id },
                data: { status, adminNote: note || null, reviewedAt: new Date() }
            });
            if (status === 'verified_external') {
                await tx.financialLedgerEntry.createMany({
                    data: [
                        {
                            userId: report.reporterId,
                            account: 'freelancer_external_payment_volume',
                            entryType: 'external_payment_verified',
                            amount: report.amount,
                            currency: report.currency,
                            status: 'verified_external',
                            isSimulated: false,
                            relatedType: 'freelance_payment_report',
                            relatedId: report.id,
                            metadata: { projectReference: report.project.reference, paidDirectlyToFreelancer: true }
                        },
                        {
                            userId: report.reporterId,
                            account: 'freelancer_external_earnings',
                            entryType: 'external_freelance_earning',
                            amount: report.freelancerNetAmount,
                            currency: report.currency,
                            status: 'verified_external',
                            isSimulated: false,
                            relatedType: 'freelance_payment_report',
                            relatedId: report.id,
                            metadata: { projectReference: report.project.reference, notWithdrawableFromSkillHub: true }
                        },
                        {
                            account: 'skillhub_commission_receivable',
                            entryType: 'freelance_commission_outstanding',
                            amount: report.commissionAmount,
                            currency: report.currency,
                            status: 'outstanding',
                            isSimulated: false,
                            relatedType: 'freelance_payment_report',
                            relatedId: report.id,
                            metadata: { projectReference: report.project.reference, notCashCollected: true }
                        }
                    ]
                });
            }
            return updated;
        }, { isolationLevel: 'Serializable' });
        res.json({
            success: true,
            paymentReport: result,
            notice: status === 'verified_external' ? 'External payment verified. Funds were paid directly to the freelancer, not SkillHub.' : undefined
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getMyFinancialSummary,
    requestWithdrawal,
    createRefundRequest,
    getMyRefundRequests,
    createFreelanceProject,
    getMyFreelanceProjects,
    updateFreelanceProjectStatus,
    createFreelancePaymentReport,
    respondToFreelancePaymentReport,
    getProjectPaymentReports,
    getAdminWithdrawalRequests,
    reviewWithdrawalRequest,
    getAdminRefundRequests,
    reviewRefundRequest,
    getAdminFreelancePaymentReports,
    reviewFreelancePaymentReport
};