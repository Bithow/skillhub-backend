const crypto = require('crypto');
const prisma = require('../utils/prisma');
const WhatsAppService = require('../utils/whatsappService');
const { getCommissionSettings } = require('../utils/commission');


const newReference = () => `TXN_${Date.now()}_${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const jsonObject = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const pageValue = value => Math.max(1, Number.parseInt(value, 10) || 1);
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const createCheckout = async (req, res) => {
    try {
        const { courseId } = req.body;
        if (typeof courseId !== 'string' || !courseId.trim()) {
            return res.status(400).json({ success: false, message: 'Valid courseId is required' });
        }
        const result = await prisma.$transaction(async tx => {
            const course = await tx.course.findFirst({ where: { id: courseId, status: 'published' }, include: { students: true } });
            if (!course) return { status: 404, message: 'Course not found' };
            if (course.students.some(student => student.userId === req.user.id)) {
                return { status: 409, message: 'Already enrolled in this course' };
            }
            const existing = await tx.transaction.findFirst({
                where: { userId: req.user.id, type: 'course_purchase', status: 'pending', courseId: course.id },
                orderBy: { createdAt: 'desc' }
            });
            if (existing?.metadata?.paymentProof) {
                return { status: 409, message: 'A receipt for this course is already awaiting review' };
            }
            const rates = existing ? null : await getCommissionSettings(tx);
            const commission = rates ? money(course.price * rates.skillhubCommissionPercent / 100) : null;
            const transaction = existing || await tx.transaction.create({
                data: {
                    userId: req.user.id,
                    type: 'course_purchase',
                    amount: course.price,
                    currency: 'USD',
                    commission,
                    netAmount: money(course.price - commission),
                    status: 'pending',
                    paymentMethod: process.env.PAYMENT_MODE === 'prelaunch_simulated' ? 'prelaunch_simulation' : 'bank_transfer',
                    reference: newReference(),
                    courseId: course.id,
                    metadata: {
                        courseId: course.id,
                        commissionRates: rates,
                        paymentMode: process.env.PAYMENT_MODE === 'prelaunch_simulated' ? 'prelaunch_simulated' : 'manual_receipt'
                    }
                }
            });
            return { transaction, course };
        });
        if (result.status) return res.status(result.status).json({ success: false, message: result.message });
        res.status(201).json({
            success: true,
            transactionId: result.transaction.id,
            reference: result.transaction.reference,
            amount: result.transaction.amount,
            courseTitle: result.course.title
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const simulateCoursePayment = async (req, res) => {
    if (process.env.PAYMENT_MODE !== 'prelaunch_simulated') {
        return res.status(403).json({ success: false, message: 'Simulated payments are disabled on this server' });
    }
    try {
        const transactionId = typeof req.body.transactionId === 'string' ? req.body.transactionId.trim() : '';
        if (!transactionId) return res.status(400).json({ success: false, message: 'A checkout transaction is required' });

        const result = await prisma.$transaction(async tx => {
            const transaction = await tx.transaction.findFirst({
                where: { id: transactionId, userId: req.user.id, type: 'course_purchase' }
            });
            if (!transaction) return { status: 404, message: 'Course checkout was not found' };
            if (transaction.isSimulated && transaction.status === 'completed') {
                return { transaction, alreadyProcessed: true };
            }
            if (transaction.status !== 'pending') return { status: 409, message: 'This checkout is no longer available' };

            const metadata = jsonObject(transaction.metadata);
            if (metadata.paymentMode !== 'prelaunch_simulated' || transaction.paymentMethod !== 'prelaunch_simulation') {
                return { status: 409, message: 'This checkout was created for a different payment mode and cannot be simulated' };
            }
            if (metadata.paymentProof) {
                return { status: 409, message: 'A real payment receipt is already awaiting review for this checkout' };
            }
            const course = await tx.course.findFirst({
                where: { id: transaction.courseId || metadata.courseId, status: 'published' },
                include: { instructor: { select: { id: true, name: true } } }
            });
            if (!course) return { status: 404, message: 'Course is no longer available' };
            const enrollment = await tx.enrollment.findUnique({
                where: { courseId_userId: { courseId: course.id, userId: req.user.id } }
            });
            if (enrollment) return { status: 409, message: 'You are already enrolled in this course' };

            const amount = Number(transaction.amount);
            const rates = metadata.commissionRates || await getCommissionSettings(tx);
            const commission = money(transaction.commission || amount * rates.skillhubCommissionPercent / 100);
            const instructorEarnings = money(transaction.netAmount || amount - commission);
            const changed = await tx.transaction.updateMany({
                where: { id: transaction.id, userId: req.user.id, status: 'pending', isSimulated: false },
                data: {
                    status: 'completed',
                    paymentMethod: 'simulated',
                    currency: transaction.currency || 'USD',
                    commission,
                    netAmount: instructorEarnings,
                    isSimulated: true,
                    completedAt: new Date(),
                    metadata: {
                        ...metadata,
                        paymentMode: 'simulated',
                        simulationNotice: 'No money was received or transferred.'
                    }
                }
            });
            if (changed.count !== 1) return { status: 409, message: 'Checkout was already processed' };

            await tx.enrollment.create({ data: { courseId: course.id, userId: req.user.id } });
            await tx.course.update({ where: { id: course.id }, data: { studentCount: { increment: 1 } } });
            await tx.financialLedgerEntry.createMany({
                data: [
                    {
                        userId: req.user.id,
                        transactionId: transaction.id,
                        account: 'simulation_clearing',
                        entryType: 'simulated_course_payment',
                        amount,
                        currency: transaction.currency || 'USD',
                        status: 'simulated',
                        isSimulated: true,
                        relatedType: 'course',
                        relatedId: course.id,
                        metadata: { courseTitle: course.title }
                    },
                    {
                        userId: course.instructorId,
                        transactionId: transaction.id,
                        account: 'instructor_earnings_simulated',
                        entryType: 'simulated_course_earning',
                        amount: instructorEarnings,
                        currency: transaction.currency || 'USD',
                        status: 'simulated_pending',
                        isSimulated: true,
                        relatedType: 'course',
                        relatedId: course.id,
                        metadata: { courseTitle: course.title, sharePercent: rates.instructorSharePercent }
                    },
                    {
                        transactionId: transaction.id,
                        account: 'skillhub_revenue_simulated',
                        entryType: 'simulated_course_commission',
                        amount: commission,
                        currency: transaction.currency || 'USD',
                        status: 'simulated',
                        isSimulated: true,
                        relatedType: 'course',
                        relatedId: course.id,
                        metadata: { courseTitle: course.title, commissionPercent: rates.skillhubCommissionPercent }
                    }
                ]
            });
            const saved = await tx.transaction.findUnique({ where: { id: transaction.id } });
            return { transaction: saved, courseTitle: course.title };
        }, { isolationLevel: 'Serializable' });

        if (result.status) return res.status(result.status).json({ success: false, message: result.message });
        res.json({
            success: true,
            simulated: true,
            message: 'Simulated payment validated. No money was received or transferred.',
            alreadyProcessed: !!result.alreadyProcessed,
            transaction: {
                id: result.transaction.id,
                reference: result.transaction.reference,
                amount: result.transaction.amount,
                currency: result.transaction.currency || 'USD',
                status: result.transaction.status,
                isSimulated: true
            },
            courseTitle: result.courseTitle || null
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const verifyPayment = async (req, res) => {
    try {
        const body = req.body || {};
        const { reference, transactionId, paymentProof, receiptImage, transactionRef, payerName, payerPhone, paymentMethod, notes } = body;
        const transactionIdentifier = reference || transactionId;
        const proof = req.file
            ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
            : paymentProof || receiptImage;
        if (!transactionIdentifier || !proof) {
            return res.status(400).json({ success: false, message: 'Checkout transaction and payment receipt are required' });
        }
        if (typeof proof !== 'string' || proof.length > 14 * 1024 * 1024) {
            return res.status(413).json({ success: false, message: 'Payment receipt is too large' });
        }
        if (transactionRef && String(transactionRef).length > 120) return res.status(400).json({ success: false, message: 'Payment reference is too long' });
        if (payerName && String(payerName).length > 100) return res.status(400).json({ success: false, message: 'Payer name is too long' });
        if (payerPhone && String(payerPhone).length > 30) return res.status(400).json({ success: false, message: 'Payer phone is too long' });
        if (notes && String(notes).length > 1000) return res.status(400).json({ success: false, message: 'Payment notes are too long' });

        const transaction = await prisma.transaction.findFirst({
            where: {
                userId: req.user.id,
                OR: [{ id: transactionIdentifier }, { reference: transactionIdentifier }]
            }
        });
        if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });
        if (transaction.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'This transaction is no longer awaiting payment review' });
        }
        if (!['course_purchase', 'deposit'].includes(transaction.type)) {
            return res.status(400).json({ success: false, message: 'Payment proof cannot be submitted for this transaction type' });
        }
        const metadata = jsonObject(transaction.metadata);
        if (metadata.paymentMode === 'prelaunch_simulated') {
            return res.status(410).json({ success: false, message: 'Receipt uploads are disabled for pre-launch simulated checkouts' });
        }
        if (metadata.paymentProof) return res.status(409).json({ success: false, message: 'A receipt has already been submitted for this transaction' });
        const normalizedMethod = String(paymentMethod || '').toLowerCase();
        const paymentMethodCode = normalizedMethod.includes('telebirr') ? 'telebirr' : normalizedMethod.includes('cbe') ? 'cbe_birr' : 'bank_transfer';
        const updated = await prisma.transaction.updateMany({
            where: { id: transaction.id, userId: req.user.id, status: 'pending' },
            data: {
                paymentMethod: paymentMethodCode,
                metadata: {
                    ...metadata,
                    paymentProof: proof,
                    paymentReference: transactionRef ? String(transactionRef).trim() : null,
                    payerName: payerName ? String(payerName).trim() : null,
                    payerPhone: payerPhone ? String(payerPhone).trim() : null,
                    paymentMethodLabel: paymentMethod ? String(paymentMethod).slice(0, 80) : null,
                    paymentNotes: notes ? String(notes).trim() : null
                }
            }
        });
        if (updated.count !== 1) return res.status(409).json({ success: false, message: 'Transaction was already submitted or reviewed' });
        const saved = await prisma.transaction.findUnique({ where: { id: transaction.id }, select: { id: true, reference: true, status: true } });
        res.status(202).json({
            success: true,
            message: 'Payment proof submitted for admin review',
            transactionId: saved.id,
            transaction: { _id: saved.id, reference: saved.reference, status: saved.status }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getTransactionStatus = async (req, res) => {
    try {
        const transaction = await prisma.transaction.findFirst({
            where: { id: req.params.id, userId: req.user.id },
            select: { id: true, status: true, reference: true, type: true, amount: true, completedAt: true }
        });
        if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });
        const status = transaction.status === 'completed'
            ? 'approved'
            : ['failed', 'refunded'].includes(transaction.status) ? 'rejected' : transaction.status;
        res.json({
            success: true,
            transaction: {
                ...transaction,
                _id: transaction.id,
                status,
                rejectionReason: transaction.metadata?.reviewReason || null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const requestWithdrawal = async (req, res) => {
    try {
        const { amount, phoneNumber, method } = req.body;
        const withdrawalAmount = Number(amount);
        const paymentMethod = method || 'telebirr';
        const allowedMethods = ['telebirr', 'cbe_birr', 'chapa', 'whatsapp', 'bank_transfer', 'wallet'];
        if (!Number.isFinite(withdrawalAmount) || withdrawalAmount < 5) {
            return res.status(400).json({ success: false, message: 'Minimum withdrawal amount is $5.00 USD' });
        }
        if (!allowedMethods.includes(paymentMethod)) return res.status(400).json({ success: false, message: 'Invalid withdrawal method' });

        const transaction = await prisma.$transaction(async tx => {
            const reserved = await tx.user.updateMany({
                where: { id: req.user.id, walletBalance: { gte: withdrawalAmount } },
                data: { walletBalance: { decrement: withdrawalAmount } }
            });
            if (reserved.count !== 1) return null;
            return tx.transaction.create({
                data: {
                    userId: req.user.id,
                    type: 'withdrawal',
                    amount: withdrawalAmount,
                    netAmount: withdrawalAmount,
                    status: 'pending',
                    paymentMethod,
                    reference: newReference(),
                    metadata: { phoneNumber: phoneNumber || req.user.phone || null, balanceReserved: true }
                }
            });
        });
        if (!transaction) return res.status(400).json({ success: false, message: 'Insufficient wallet balance' });
        await WhatsAppService.sendToAdmin(
            `Withdrawal Request\nUser: ${req.user.name}\nAmount: $${withdrawalAmount.toFixed(2)} USD\nPhone: ${phoneNumber || req.user.phone}\nReference: ${transaction.reference}`
        );
        res.status(201).json({ success: true, message: 'Withdrawal request submitted. You will be notified when processed.', transaction: { ...transaction, _id: transaction.id } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMyTransactions = async (req, res) => {
    try {
        const page = pageValue(req.query.page);
        const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
        const where = { userId: req.user.id };
        if (req.query.type) where.type = req.query.type;
        const [transactions, total] = await prisma.$transaction([
            prisma.transaction.findMany({ where, include: { course: { select: { id: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: limit, skip: (page - 1) * limit }),
            prisma.transaction.count({ where })
        ]);
        res.json({
            success: true,
            transactions: transactions.map(transaction => ({ ...transaction, _id: transaction.id })),
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const addFunds = async (req, res) => {
    try {
        const amount = Number(req.body.amount);
        const paymentMethod = req.body.paymentMethod || 'telebirr';
        if (!Number.isFinite(amount) || amount < 1) return res.status(400).json({ success: false, message: 'Minimum deposit is $1.00 USD' });
        if (!['telebirr', 'cbe_birr', 'chapa', 'whatsapp', 'bank_transfer', 'wallet'].includes(paymentMethod)) {
            return res.status(400).json({ success: false, message: 'Invalid payment method' });
        }
        const transaction = await prisma.transaction.create({
            data: {
                userId: req.user.id,
                type: 'deposit',
                amount,
                netAmount: amount,
                status: 'pending',
                paymentMethod,
                reference: newReference()
            }
        });
        const paymentLink = `https://api.telebirr.et/pay?amount=${amount.toFixed(2)}&reference=${transaction.reference}`;
        if (req.user.phone) {
            await WhatsAppService.sendToNumber(
                req.user.phone,
                `Add Funds to Wallet\nAmount: $${amount.toFixed(2)} USD\nReference: ${transaction.reference}\n\nClick to pay: ${paymentLink}\n\nReply with PAID ${transaction.reference} after completing payment.`
            );
        }
        res.status(201).json({
            success: true,
            message: req.user.phone ? 'Payment link sent to your WhatsApp' : 'Deposit transaction created',
            transaction: { ...transaction, _id: transaction.id }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createCheckout,
    simulateCoursePayment,
    verifyPayment,
    getTransactionStatus,
    requestWithdrawal,
    getMyTransactions,
    addFunds
};
