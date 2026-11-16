const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (testDatabaseUrl) {
    const databaseName = new URL(testDatabaseUrl).pathname.replace(/^\//, '');
    if (!databaseName.toLowerCase().includes('test')) {
        throw new Error('TEST_DATABASE_URL must point to a database with "test" in its name');
    }
}
process.env.DATABASE_URL = testDatabaseUrl || 'postgresql://skillhub:placeholder@localhost:5432/skillhub_test';
process.env.JWT_SECRET = 'skillhub-integration-test-secret';
process.env.PAYMENT_MODE = 'prelaunch_simulated';

const { app: serverApp } = require('../server');
const prisma = require('../utils/prisma');

const enabled = Boolean(testDatabaseUrl);
let runId;
const userIds = [];
const courseIds = [];
const transactionIds = [];
const ledgerEntryIds = [];
const freelanceProjectIds = [];
const freelancePaymentReportIds = [];
const refundRequestIds = [];
const withdrawalRequestIds = [];
const contactMessageIds = [];

before(async () => {
    if (!enabled) return;
    await prisma.$connect();
    runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
});

after(async () => {
    if (!enabled) return;
    await prisma.message.deleteMany({ where: { OR: [{ senderId: { in: userIds } }, { receiverId: { in: userIds } }] } });
    await prisma.contactMessage.deleteMany({ where: { id: { in: contactMessageIds } } });
    await prisma.refundRequest.deleteMany({ where: { id: { in: refundRequestIds } } });
    await prisma.withdrawalRequest.deleteMany({ where: { id: { in: withdrawalRequestIds } } });
    await prisma.freelancePaymentReport.deleteMany({ where: { id: { in: freelancePaymentReportIds } } });
    await prisma.freelanceProject.deleteMany({ where: { id: { in: freelanceProjectIds } } });
    await prisma.financialLedgerEntry.deleteMany({
        where: {
            OR: [
                { id: { in: ledgerEntryIds } },
                { userId: { in: userIds } },
                { relatedId: { in: freelancePaymentReportIds } },
                { relatedId: { in: withdrawalRequestIds } }
            ]
        }
    });
    await prisma.transaction.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { id: { in: transactionIds } }] } });
    await prisma.enrollment.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { courseId: { in: courseIds } }] } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
    await prisma.freelancer.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
});

const createUser = async (suffix, { role = 'user', walletBalance = 0 } = {}) => {
    const user = await prisma.user.create({ data: {
        name: `Test ${suffix}`,
        email: `${suffix}_${runId}@example.com`,
        password: 'not-used-by-bearer-tests',
        role,
        status: 'active',
        walletBalance,
        referralCode: `REF_${suffix}_${runId}`
    } });
    userIds.push(user.id);
    return user;
};

const authHeader = user => `Bearer ${jwt.sign({ id: user.id }, process.env.JWT_SECRET)}`;
const createCourse = async (instructor, suffix = 'course') => {
    const course = await prisma.course.create({ data: {
        title: `Integration Course ${suffix}`,
        description: 'A sufficiently long course description for integration testing.',
        price: 100,
        category: 'other',
        instructorId: instructor.id,
        instructorName: instructor.name,
        status: 'published',
        lessons: [
            { title: 'Preview lesson', isFree: true, videoUrl: 'https://example.com/free' },
            { title: 'Paid lesson', isFree: false, videoUrl: 'https://example.com/paid' }
        ]
    } });
    courseIds.push(course.id);
    return course;
};

test('course checkout is server-priced and approval enrolls exactly once', { skip: !enabled }, async () => {
    const student = await createUser('student');
    const instructor = await createUser('instructor', { role: 'instructor' });
    const admin = await createUser('admin', { role: 'admin' });
    const course = await createCourse(instructor);

    const checkout = await request(serverApp)
        .post('/api/payments/checkout')
        .set('Authorization', authHeader(student))
        .send({ courseId: course.id, amount: 0.01 });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.amount, 100);

    const receipt = await request(serverApp)
        .post('/api/payments/submit-receipt')
        .set('Authorization', authHeader(student))
        .field('transactionId', checkout.body.transactionId)
        .field('transactionRef', 'BANK-123')
        .field('payerName', student.name)
        .attach('receiptImage', Buffer.from('receipt data'), { filename: 'receipt.png', contentType: 'image/png' });
    assert.equal(receipt.status, 202);

    const status = await request(serverApp)
        .get(`/api/payments/transactions/${checkout.body.transactionId}`)
        .set('Authorization', authHeader(student));
    assert.equal(status.body.transaction.status, 'pending');

    const approval = await request(serverApp)
        .put(`/api/admin/transactions/${checkout.body.transactionId}/approve`)
        .set('Authorization', authHeader(admin))
        .send({});
    assert.equal(approval.status, 200);
    assert.equal(await prisma.enrollment.count({ where: { courseId: course.id, userId: student.id } }), 1);
    assert.equal((await prisma.course.findUnique({ where: { id: course.id } })).studentCount, 1);
    assert.equal((await prisma.user.findUnique({ where: { id: instructor.id } })).walletBalance, 80);

    const duplicate = await request(serverApp)
        .put(`/api/admin/transactions/${checkout.body.transactionId}/approve`)
        .set('Authorization', authHeader(admin))
        .send({});
    assert.equal(duplicate.status, 409);
});

test('simulated course payment enrolls once and never credits real wallet balances', { skip: !enabled }, async () => {
    const student = await createUser('simulated-student');
    const instructor = await createUser('simulated-instructor', { role: 'instructor' });
    const course = await createCourse(instructor, 'simulated');

    const checkout = await request(serverApp)
        .post('/api/payments/checkout')
        .set('Authorization', authHeader(student))
        .send({ courseId: course.id, amount: 0.01 });
    assert.equal(checkout.status, 201);
    assert.equal(checkout.body.amount, 100);
    transactionIds.push(checkout.body.transactionId);

    const simulated = await request(serverApp)
        .post('/api/payments/simulate')
        .set('Authorization', authHeader(student))
        .send({ transactionId: checkout.body.transactionId });
    assert.equal(simulated.status, 200);
    assert.equal(simulated.body.simulated, true);
    assert.equal(simulated.body.transaction.isSimulated, true);
    assert.equal(simulated.body.transaction.status, 'completed');
    assert.match(simulated.body.message, /No money was received or transferred/);
    assert.equal(await prisma.enrollment.count({ where: { courseId: course.id, userId: student.id } }), 1);
    assert.equal((await prisma.course.findUnique({ where: { id: course.id } })).studentCount, 1);
    assert.equal((await prisma.user.findUnique({ where: { id: instructor.id } })).walletBalance, 0);

    const entries = await prisma.financialLedgerEntry.findMany({ where: { transactionId: checkout.body.transactionId } });
    ledgerEntryIds.push(...entries.map(entry => entry.id));
    assert.equal(entries.length, 3);
    assert.ok(entries.every(entry => entry.isSimulated));
    assert.ok(entries.every(entry => entry.status === 'simulated' || entry.status === 'simulated_pending'));

    const duplicate = await request(serverApp)
        .post('/api/payments/simulate')
        .set('Authorization', authHeader(student))
        .send({ transactionId: checkout.body.transactionId });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.alreadyProcessed, true);
    assert.equal(await prisma.enrollment.count({ where: { courseId: course.id, userId: student.id } }), 1);
    assert.equal(await prisma.financialLedgerEntry.count({ where: { transactionId: checkout.body.transactionId } }), 3);
});

test('freelance payment reports remain external and never credit SkillHub wallet funds', { skip: !enabled }, async () => {
    const client = await createUser('project-client', { role: 'client' });
    const freelancerUser = await createUser('project-freelancer', { role: 'freelancer' });
    const admin = await createUser('project-admin', { role: 'admin' });
    const freelancer = await prisma.freelancer.create({
        data: { userId: freelancerUser.id, title: 'Integration Freelancer', hourlyRate: 45, status: 'approved' }
    });

    const created = await request(serverApp)
        .post('/api/freelancers/projects')
        .set('Authorization', authHeader(client))
        .send({ freelancerId: freelancer.id, title: 'External payment verification', description: 'Test external direct payment reporting.', budget: 200, currency: 'USD' });
    assert.equal(created.status, 201);
    const project = created.body.project;
    freelanceProjectIds.push(project.id);
    assert.equal(project.paymentArrangement, 'direct_external');

    const delivered = await request(serverApp)
        .patch(`/api/freelancers/projects/${project.id}`)
        .set('Authorization', authHeader(freelancerUser))
        .send({ status: 'delivered' });
    assert.equal(delivered.status, 200);
    const completed = await request(serverApp)
        .patch(`/api/freelancers/projects/${project.id}`)
        .set('Authorization', authHeader(client))
        .send({ status: 'completed' });
    assert.equal(completed.status, 200);

    const reported = await request(serverApp)
        .post(`/api/freelancers/projects/${project.id}/payment-reports`)
        .set('Authorization', authHeader(freelancerUser))
        .send({ amount: 200, currency: 'USD', paymentDate: new Date().toISOString(), paymentMethodDescription: 'Client bank transfer', transactionReference: 'EXT-123' });
    assert.equal(reported.status, 201);
    assert.match(reported.body.notice, /not money received by SkillHub/);
    const reportId = reported.body.paymentReport.id;
    freelancePaymentReportIds.push(reportId);

    const clientConfirm = await request(serverApp)
        .put(`/api/freelancers/projects/${project.id}/payment-reports/${reportId}/client-response`)
        .set('Authorization', authHeader(client))
        .send({ decision: 'confirm', response: 'Confirmed' });
    assert.equal(clientConfirm.status, 200);
    assert.equal(clientConfirm.body.paymentReport.status, 'client_confirmed');

    const verified = await request(serverApp)
        .put(`/api/admin/freelance-payment-reports/${reportId}/review`)
        .set('Authorization', authHeader(admin))
        .send({ status: 'verified_external' });
    assert.equal(verified.status, 200);
    assert.match(verified.body.notice, /not SkillHub/);
    const ledger = await prisma.financialLedgerEntry.findMany({ where: { relatedId: reportId } });
    assert.equal(ledger.length, 3);
    assert.ok(ledger.every(entry => entry.status !== 'collected' && entry.account !== 'skillhub_revenue'));
    assert.equal((await prisma.user.findUnique({ where: { id: freelancerUser.id } })).walletBalance, 0);
});

test('withdrawal requests reserve eligible ledger amounts without transferring money', { skip: !enabled }, async () => {
    const instructor = await createUser('withdrawal-instructor', { role: 'instructor' });
    const admin = await createUser('withdrawal-review-admin', { role: 'admin' });
    const earning = await prisma.financialLedgerEntry.create({
        data: { userId: instructor.id, account: 'instructor_earnings', entryType: 'course_earning', amount: 120, currency: 'USD', status: 'eligible', isSimulated: false }
    });
    ledgerEntryIds.push(earning.id);

    const withdrawalResult = await request(serverApp)
        .post('/api/payments/withdrawal-requests')
        .set('Authorization', authHeader(instructor))
        .send({ amount: 75, currency: 'USD', payoutMethod: 'mobile_money', destination: '12345678' });
    assert.equal(withdrawalResult.status, 201);
    assert.equal(withdrawalResult.body.withdrawal.status, 'requested');
    withdrawalRequestIds.push(withdrawalResult.body.withdrawal.id);
    assert.match(withdrawalResult.body.message, /No transfer was initiated/);

    const overspend = await request(serverApp)
        .post('/api/payments/withdrawal-requests')
        .set('Authorization', authHeader(instructor))
        .send({ amount: 50, currency: 'USD', payoutMethod: 'mobile_money' });
    assert.equal(overspend.status, 400);

    const simulatedCompletion = await request(serverApp)
        .put(`/api/admin/withdrawal-requests/${withdrawalResult.body.withdrawal.id}/review`)
        .set('Authorization', authHeader(admin))
        .send({ status: 'completed', payoutReference: 'SIM-PAYOUT-1' });
    assert.equal(simulatedCompletion.status, 200);
    assert.match(simulatedCompletion.body.notice, /No money was transferred/);
    assert.equal((await prisma.user.findUnique({ where: { id: instructor.id } })).walletBalance, 0);
    assert.equal(await prisma.financialLedgerEntry.count({ where: { relatedId: withdrawalResult.body.withdrawal.id, entryType: 'simulated_withdrawal_completion' } }), 1);
});

test('receipt submission and transaction polling are owner-scoped', { skip: !enabled }, async () => {
    const owner = await createUser('owner');
    const stranger = await createUser('stranger');
    const instructor = await createUser('instructor2', { role: 'instructor' });
    const course = await createCourse(instructor, 'ownership');
    const checkout = await request(serverApp)
        .post('/api/payments/checkout')
        .set('Authorization', authHeader(owner))
        .send({ courseId: course.id });

    const status = await request(serverApp)
        .get(`/api/payments/transactions/${checkout.body.transactionId}`)
        .set('Authorization', authHeader(stranger));
    assert.equal(status.status, 404);

    const receipt = await request(serverApp)
        .post('/api/payments/submit')
        .set('Authorization', authHeader(stranger))
        .send({ transactionId: checkout.body.transactionId, receiptImage: 'data:image/png;base64,dGVzdA==' });
    assert.equal(receipt.status, 404);
});

test('settlement fails without mutating an already-enrolled transaction', { skip: !enabled }, async () => {
    const student = await createUser('already-enrolled');
    const instructor = await createUser('instructor3', { role: 'instructor' });
    const admin = await createUser('admin2', { role: 'admin' });
    const course = await createCourse(instructor, 'already-enrolled');
    await prisma.enrollment.create({ data: { courseId: course.id, userId: student.id } });
    const transaction = await prisma.transaction.create({
        data: {
            userId: student.id,
            type: 'course_purchase',
            amount: course.price,
            netAmount: course.price * 0.8,
            status: 'pending',
            paymentMethod: 'bank_transfer',
            reference: `TXN_${runId}_rollback`,
            courseId: course.id,
            metadata: { courseId: course.id }
        }
    });
    transactionIds.push(transaction.id);

    const result = await request(serverApp)
        .put(`/api/admin/transactions/${transaction.id}/status`)
        .set('Authorization', authHeader(admin))
        .send({ status: 'completed' });
    assert.equal(result.status, 409);
    assert.equal((await prisma.transaction.findUnique({ where: { id: transaction.id } })).status, 'pending');
    assert.equal((await prisma.user.findUnique({ where: { id: instructor.id } })).walletBalance, 0);
});

test('rejecting a withdrawal restores reserved funds only once', { skip: !enabled }, async () => {
    const user = await createUser('withdrawal', { walletBalance: 400 });
    const admin = await createUser('withdrawal-admin', { role: 'admin' });
    const transaction = await prisma.transaction.create({
        data: {
            userId: user.id,
            type: 'withdrawal',
            amount: 100,
            netAmount: 100,
            status: 'pending',
            paymentMethod: 'telebirr',
            reference: `TXN_${runId}_withdrawal`,
            metadata: { balanceReserved: true }
        }
    });
    transactionIds.push(transaction.id);
    await prisma.user.update({ where: { id: user.id }, data: { walletBalance: 300 } });

    const rejection = await request(serverApp)
        .put(`/api/admin/transactions/${transaction.id}/reject`)
        .set('Authorization', authHeader(admin))
        .send({ reason: 'Receipt was unreadable.' });
    assert.equal(rejection.status, 200);
    assert.equal(rejection.body.transaction.metadata.reviewReason, 'Receipt was unreadable.');
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).walletBalance, 400);

    const duplicate = await request(serverApp)
        .put(`/api/admin/transactions/${transaction.id}/reject`)
        .set('Authorization', authHeader(admin))
        .send({ reason: 'Receipt was unreadable.' });
    assert.equal(duplicate.status, 409);
    assert.equal((await prisma.user.findUnique({ where: { id: user.id } })).walletBalance, 400);
});

test('public course details hide paid lessons and private contact data', { skip: !enabled }, async () => {
    const instructor = await createUser('course-privacy-instructor', { role: 'instructor' });
    const visitor = await createUser('course-privacy-visitor');
    const course = await createCourse(instructor, 'privacy');
    await prisma.course.update({ where: { id: course.id }, data: { instructorPhone: '+256700000000' } });

    const response = await request(serverApp)
        .get(`/api/courses/${course.id}`)
        .set('Authorization', authHeader(visitor));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.course.lessons.map(lesson => lesson.title), ['Preview lesson']);
    assert.equal(response.body.course.instructorPhone, undefined);
    assert.equal(response.body.course.instructorId.name, instructor.name);
    assert.deepEqual(response.body.course.students, []);
});

test('course discussions require enrollment and chat messages persist between participants', { skip: !enabled }, async () => {
    const instructor = await createUser('discussion-instructor', { role: 'instructor' });
    const enrolled = await createUser('discussion-enrolled');
    const visitor = await createUser('discussion-visitor');
    const course = await createCourse(instructor, 'discussion');
    await prisma.enrollment.create({ data: { courseId: course.id, userId: enrolled.id } });

    const denied = await request(serverApp)
        .get(`/api/courses/${course.id}/discussion`)
        .set('Authorization', authHeader(visitor));
    assert.equal(denied.status, 403);

    const posted = await request(serverApp)
        .post(`/api/courses/${course.id}/discussion`)
        .set('Authorization', authHeader(enrolled))
        .send({ message: 'A database-backed discussion post' });
    assert.equal(posted.status, 200);

    const sent = await request(serverApp)
        .post('/api/chat/send')
        .set('Authorization', authHeader(enrolled))
        .send({ receiverId: instructor.id, content: 'Hello in SkillHub chat' });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.senderId._id, enrolled.id);

    const conversation = await request(serverApp)
        .get(`/api/chat/conversation/${instructor.id}`)
        .set('Authorization', authHeader(enrolled));
    assert.equal(conversation.status, 200);
    assert.equal(conversation.body.messages.length, 1);
    assert.equal(conversation.body.messages[0].content, 'Hello in SkillHub chat');
});

test('course progress is persisted and calculated from enrolled lesson indices', { skip: !enabled }, async () => {
    const instructor = await createUser('progress-instructor', { role: 'instructor' });
    const student = await createUser('progress-student');
    const visitor = await createUser('progress-visitor');
    const course = await createCourse(instructor, 'progress');
    await prisma.enrollment.create({ data: { courseId: course.id, userId: student.id } });

    const denied = await request(serverApp)
        .get(`/api/courses/${course.id}/progress`)
        .set('Authorization', authHeader(visitor));
    assert.equal(denied.status, 403);

    const update = await request(serverApp)
        .post(`/api/courses/${course.id}/progress`)
        .set('Authorization', authHeader(student))
        .send({ progress: 10, completedLessons: [0] });
    assert.equal(update.status, 200);
    assert.equal(update.body.progress, 50);
    assert.equal(update.body.completed, false);

    const completion = await request(serverApp)
        .post(`/api/courses/${course.id}/progress`)
        .set('Authorization', authHeader(student))
        .send({ progress: 25, completedLessons: [1, 0, 1] });
    assert.equal(completion.status, 200);
    assert.equal(completion.body.progress, 100);
    assert.equal(completion.body.completed, true);
    assert.deepEqual(completion.body.completedLessons, [0, 1]);

    const saved = await prisma.enrollment.findUnique({
        where: { courseId_userId: { courseId: course.id, userId: student.id } }
    });
    assert.equal(saved.progress, 100);
    assert.ok(saved.completedAt);

    const certificate = await request(serverApp)
        .get(`/api/courses/${course.id}/certificate`)
        .set('Authorization', authHeader(student));
    assert.equal(certificate.status, 200);
    assert.equal(certificate.body.userName, student.name);
    assert.equal(certificate.body.courseTitle, course.title);
    assert.match(certificate.body.certificateId, /^SKH-[A-F0-9]{12}$/);

    const visitorCertificate = await request(serverApp)
        .get(`/api/courses/${course.id}/certificate`)
        .set('Authorization', authHeader(visitor));
    assert.equal(visitorCertificate.status, 403);
});

test('auth profile preserves nested API IDs without returning credentials', { skip: !enabled }, async () => {
    const instructor = await createUser('profile-instructor', { role: 'instructor' });
    const course = await createCourse(instructor, 'profile');
    const freelancer = await prisma.freelancer.create({
        data: {
            userId: instructor.id,
            title: 'Test instructor freelancer profile',
            skills: ['teaching'],
            hourlyRate: 100,
            status: 'approved'
        }
    });

    const response = await request(serverApp)
        .get('/api/auth/me')
        .set('Authorization', authHeader(instructor));
    assert.equal(response.status, 200);
    assert.equal(response.body.user._id, instructor.id);
    assert.equal(response.body.user.courses[0]._id, course.id);
    assert.equal(response.body.user.freelancerProfile._id, freelancer.id);
    assert.equal(response.body.user.freelancerProfile.userId, instructor.id);
    assert.equal(response.body.user.password, undefined);
    assert.equal(response.body.user.resetCode, undefined);
});

test('hire requests are recorded for the freelancer owner without exposing client phone', { skip: !enabled }, async () => {
    const client = await createUser('hire-client');
    const freelancerUser = await createUser('hire-freelancer', { role: 'freelancer' });
    const otherFreelancerUser = await createUser('hire-other-freelancer', { role: 'freelancer' });
    const freelancer = await prisma.freelancer.create({
        data: { userId: freelancerUser.id, title: 'Hireable designer', skills: ['design'], hourlyRate: 150, status: 'approved' }
    });
    const otherFreelancer = await prisma.freelancer.create({
        data: { userId: otherFreelancerUser.id, title: 'Another designer', skills: ['design'], hourlyRate: 120, status: 'approved' }
    });

    const created = await request(serverApp)
        .post(`/api/freelancers/${freelancer.id}/hire-requests`)
        .set('Authorization', authHeader(client))
        .send({ message: 'Please help with a product design project.' });
    assert.equal(created.status, 201);
    assert.equal(created.body.request.clientId, client.id);
    assert.equal(created.body.request.message, 'Please help with a product design project.');
    assert.equal(created.body.request.clientPhone, undefined);

    const duplicate = await request(serverApp)
        .post(`/api/freelancers/${freelancer.id}/hire-requests`)
        .set('Authorization', authHeader(client))
        .send({ message: 'Duplicate request' });
    assert.equal(duplicate.status, 409);

    const ownRequests = await request(serverApp)
        .get('/api/freelancers/hire-requests')
        .set('Authorization', authHeader(freelancerUser));
    assert.equal(ownRequests.status, 200);
    assert.equal(ownRequests.body.requests.length, 1);
    assert.equal(ownRequests.body.requests[0].clientId, client.id);

    const otherRequests = await request(serverApp)
        .get('/api/freelancers/hire-requests')
        .set('Authorization', authHeader(otherFreelancerUser));
    assert.equal(otherRequests.status, 200);
    assert.deepEqual(otherRequests.body.requests, []);
    assert.notEqual(freelancer.id, otherFreelancer.id);
});

test('exchange rates persist in PostgreSQL and require admin role', { skip: !enabled }, async () => {
    const admin = await createUser('rates-admin', { role: 'admin' });
    const user = await createUser('rates-user');
    const rates = {
        ET: { code: 'ETB', name: 'Ethiopia', rate: 180 },
        UG: { code: 'UGX', name: 'Uganda', rate: 3600 }
    };

    const denied = await request(serverApp)
        .post('/api/admin/settings/exchange-rates')
        .set('Authorization', authHeader(user))
        .send({ rates });
    assert.equal(denied.status, 403);

    const saved = await request(serverApp)
        .post('/api/admin/settings/exchange-rates')
        .set('Authorization', authHeader(admin))
        .send({ rates });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.rates.ET.rate, 180);

    const fetched = await request(serverApp)
        .get('/api/admin/settings/exchange-rates')
        .set('Authorization', authHeader(admin));
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.rates.UG.rate, 3600);
});

test('chat search excludes self/inactive accounts and typing signals expire per pair', { skip: !enabled }, async () => {
    const sender = await createUser('chat-search-sender');
    const receiver = await createUser('chat-search-receiver');
    const inactive = await createUser('chat-search-inactive');
    await prisma.user.update({ where: { id: inactive.id }, data: { status: 'suspended' } });

    const search = await request(serverApp)
        .get('/api/users/search?q=chat-search')
        .set('Authorization', authHeader(sender));
    assert.equal(search.status, 200);
    assert.deepEqual(search.body.users.map(user => user._id), [receiver.id]);
    assert.equal(search.body.users[0].email, undefined);

    const sent = await request(serverApp)
        .post('/api/chat/typing')
        .set('Authorization', authHeader(sender))
        .send({ receiverId: receiver.id });
    assert.equal(sent.status, 200);

    const visible = await request(serverApp)
        .get(`/api/chat/typing/${sender.id}`)
        .set('Authorization', authHeader(receiver));
    assert.equal(visible.body.isTyping, true);

    const hiddenFromOther = await request(serverApp)
        .get(`/api/chat/typing/${sender.id}`)
        .set('Authorization', authHeader(inactive));
    assert.equal(hiddenFromOther.status, 403);

    await prisma.chatTyping.update({
        where: { senderId_receiverId: { senderId: sender.id, receiverId: receiver.id } },
        data: { expiresAt: new Date(Date.now() - 1000) }
    });
    const expired = await request(serverApp)
        .get(`/api/chat/typing/${sender.id}`)
        .set('Authorization', authHeader(receiver));
    assert.equal(expired.body.isTyping, false);
});

test('contact form stores messages and moderation listing is admin-only', { skip: !enabled }, async () => {
    const user = await createUser('contact-user');
    const admin = await createUser('contact-admin', { role: 'admin' });
    const payload = {
        name: 'Site Visitor',
        email: 'visitor@example.com',
        phone: '+256700000001',
        subject: 'support',
        message: 'Please help me with my account.'
    };

    const forbidden = await request(serverApp)
        .get('/api/contact/messages')
        .set('Authorization', authHeader(user));
    assert.equal(forbidden.status, 403);

    const submitted = await request(serverApp).post('/api/contact').send(payload);
    assert.equal(submitted.status, 201);
    contactMessageIds.push(submitted.body.id);

    const listed = await request(serverApp)
        .get('/api/contact/messages')
        .set('Authorization', authHeader(admin));
    assert.equal(listed.status, 200);
    const message = listed.body.messages.find(row => row._id === submitted.body.id);
    assert.equal(message.email, payload.email);
    assert.equal(message.subject, payload.subject);
    assert.equal(message.message, payload.message);

    const invalid = await request(serverApp).post('/api/contact').send({ ...payload, subject: 'admin' });
    assert.equal(invalid.status, 400);
});

test('business inquiries are available to admins and can be updated through a review workflow', { skip: !enabled }, async () => {
    const admin = await createUser('business-admin', { role: 'admin' });
    const payload = {
        name: 'Acme Training Lead',
        email: 'training@acme.com',
        phone: '+256700123456',
        subject: 'business',
        message: 'We need a staff training program and business onboarding support.'
    };

    const submitted = await request(serverApp).post('/api/contact').send(payload);
    assert.equal(submitted.status, 201);
    contactMessageIds.push(submitted.body.id);

    const inquiryList = await request(serverApp)
        .get('/api/admin/inquiries')
        .set('Authorization', authHeader(admin));
    assert.equal(inquiryList.status, 200);
    const inquiry = inquiryList.body.inquiries.find(row => row._id === submitted.body.id);
    assert.ok(inquiry);
    assert.equal(inquiry.subject, 'business');
    assert.equal(inquiry.status, 'new');

    const updated = await request(serverApp)
        .put(`/api/admin/inquiries/${submitted.body.id}/status`)
        .set('Authorization', authHeader(admin))
        .send({ status: 'in_progress' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.inquiry.status, 'in_progress');
    assert.equal(updated.body.inquiry.subject, 'business');
});

test('support tickets are available to admins and can be progressed through the queue', { skip: !enabled }, async () => {
    const admin = await createUser('support-admin', { role: 'admin' });
    const payload = {
        name: 'Student Support User',
        email: 'support-user@example.com',
        phone: '+256700654321',
        subject: 'support',
        message: 'I cannot access my course dashboard and need a password reset.'
    };

    const submitted = await request(serverApp).post('/api/contact').send(payload);
    assert.equal(submitted.status, 201);
    contactMessageIds.push(submitted.body.id);

    const ticketList = await request(serverApp)
        .get('/api/admin/tickets')
        .set('Authorization', authHeader(admin));
    assert.equal(ticketList.status, 200);
    const ticket = ticketList.body.tickets.find(row => row._id === submitted.body.id);
    assert.ok(ticket);
    assert.equal(ticket.subject, 'support');
    assert.equal(ticket.status, 'new');

    const updated = await request(serverApp)
        .put(`/api/admin/tickets/${submitted.body.id}/status`)
        .set('Authorization', authHeader(admin))
        .send({ status: 'open' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.ticket.status, 'open');
    assert.equal(updated.body.ticket.subject, 'support');
});

test('reports and complaints are visible in the admin queue and can be escalated', { skip: !enabled }, async () => {
    const admin = await createUser('reports-admin', { role: 'admin' });
    const payload = {
        name: 'Platform Reporter',
        email: 'reporter@example.com',
        phone: '+256700765432',
        subject: 'report',
        message: 'A freelancer is misrepresenting credentials and I need this reviewed.'
    };

    const submitted = await request(serverApp).post('/api/contact').send(payload);
    assert.equal(submitted.status, 201);
    contactMessageIds.push(submitted.body.id);

    const reportList = await request(serverApp)
        .get('/api/admin/reports')
        .set('Authorization', authHeader(admin));
    assert.equal(reportList.status, 200);
    const report = reportList.body.reports.find(row => row._id === submitted.body.id);
    assert.ok(report);
    assert.equal(report.subject, 'report');
    assert.equal(report.status, 'new');

    const updated = await request(serverApp)
        .put(`/api/admin/reports/${submitted.body.id}/status`)
        .set('Authorization', authHeader(admin))
        .send({ status: 'reviewing' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.report.status, 'reviewing');
    assert.equal(updated.body.report.subject, 'report');
});

test('public platform search returns only published courses and approved active freelancers', { skip: !enabled }, async () => {
    const courseInstructor = await createUser('global-search-course-instructor', { role: 'instructor' });
    const publishedCourse = await prisma.course.create({
        data: {
            title: 'Public Quasar Design',
            description: 'Learn practical graphic design skills through lessons.',
            price: 90,
            category: 'design',
            instructorId: courseInstructor.id,
            instructorName: courseInstructor.name,
            status: 'published'
        }
    });
    courseIds.push(publishedCourse.id);
    const pendingCourse = await prisma.course.create({
        data: {
            title: 'Pending Quasar Design',
            description: 'This pending graphic design course must remain private to public search.',
            price: 70,
            category: 'design',
            instructorId: courseInstructor.id,
            status: 'pending'
        }
    });
    courseIds.push(pendingCourse.id);

    const approvedUser = await createUser('global-search-freelancer', { role: 'freelancer' });
    const pendingUser = await createUser('global-search-pending-freelancer', { role: 'freelancer' });
    await prisma.freelancer.create({
        data: { userId: approvedUser.id, title: 'Quasar Specialist', skills: ['quasar'], hourlyRate: 45, status: 'approved' }
    });
    await prisma.freelancer.create({
        data: { userId: pendingUser.id, title: 'Quasar Pending Specialist', skills: ['quasar'], hourlyRate: 30, status: 'pending' }
    });

    const results = await request(serverApp).get('/api/users/platform-search?q=quasar');
    assert.equal(results.status, 200);
    assert.deepEqual(results.body.courses.map(course => course._id), [publishedCourse.id]);
    assert.equal(results.body.freelancers.length, 1);
    assert.equal(results.body.freelancers[0].userId._id, approvedUser.id);
    assert.equal(results.body.freelancers[0].userId.email, undefined);
});
