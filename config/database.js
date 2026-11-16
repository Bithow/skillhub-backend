const prisma = require('../utils/prisma');

const connectDB = async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable is not set');
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    console.log('Connected to PostgreSQL');
};

module.exports = connectDB;