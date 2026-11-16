require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('./utils/prisma');

const seed = async () => {
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password || password.length < 12) {
        throw new Error('Set SEED_ADMIN_EMAIL and a SEED_ADMIN_PASSWORD of at least 12 characters.');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    const hashedPassword = await bcrypt.hash(password, 10);
    const admin = existing
        ? await prisma.user.update({
            where: { id: existing.id },
            data: { name: existing.name || 'SkillHub Admin', role: 'admin', status: 'active', password: hashedPassword }
        })
        : await prisma.user.create({
            data: {
                name: 'SkillHub Admin',
                email: normalizedEmail,
                password: hashedPassword,
                role: 'admin',
                status: 'active',
                referralCode: `ADMIN_${Date.now()}`
            }
        });
    console.log(`Admin account ready for ${admin.email}`);
};

seed()
    .catch(error => {
        console.error(`PostgreSQL seed failed: ${error.message}`);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
