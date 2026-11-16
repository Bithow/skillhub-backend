const { PrismaClient } = require('@prisma/client');

const globalForPrisma = globalThis;

const prisma = globalForPrisma.skillhubPrisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.skillhubPrisma = prisma;

module.exports = prisma;
