/**
 * Shared commission helper.
 * Used by paymentController and courseController so the same
 * logic (and the same AppSetting row) drives every transaction.
 *
 * @param {import('@prisma/client').PrismaClient | object} tx
 *   A Prisma client or transaction client.
 * @returns {{ instructorSharePercent: number, skillhubCommissionPercent: number }}
 */
const getCommissionSettings = async tx => {
    const setting = await tx.appSetting.findUnique({ where: { key: 'commissionSettings' } });
    const course = setting?.value?.course || {};
    const instructorSharePercent = Number(course.instructorSharePercent ?? 80);
    const skillhubCommissionPercent = Number(course.skillhubCommissionPercent ?? 20);
    if (
        !Number.isFinite(instructorSharePercent) ||
        !Number.isFinite(skillhubCommissionPercent) ||
        instructorSharePercent < 0 ||
        skillhubCommissionPercent < 0 ||
        Math.abs(instructorSharePercent + skillhubCommissionPercent - 100) > 0.0001
    ) {
        throw new Error('Course commission settings are invalid');
    }
    return { instructorSharePercent, skillhubCommissionPercent };
};

module.exports = { getCommissionSettings };
