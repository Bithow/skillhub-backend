const prisma = require('../utils/prisma');

const getAiStudioStatus = async (req, res) => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    try {
        const [usage, queuedJobs, activeJobs, completedJobs, failedJobs] = await Promise.all([
            prisma.aiUsageRecord.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { estimatedCost: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
            prisma.aiProductionJob.count({ where: { status: 'queued' } }),
            prisma.aiProductionJob.count({ where: { status: 'generating' } }),
            prisma.aiProductionJob.count({ where: { status: 'completed' } }),
            prisma.aiProductionJob.count({ where: { status: 'failed' } })
        ]);
        res.json({
            success: true,
            services: {
                courseGeneration: Boolean(process.env.AI_STUDIO_API_KEY),
                videoProduction: Boolean(process.env.AI_STUDIO_VIDEO_API_KEY),
                voiceGeneration: Boolean(process.env.AI_STUDIO_VOICE_API_KEY),
                fileStorage: Boolean(process.env.AI_STUDIO_STORAGE_BUCKET)
            },
            provider: process.env.AI_STUDIO_API_KEY ? (process.env.AI_STUDIO_PROVIDER || 'openai-compatible') : null,
            model: process.env.AI_STUDIO_API_KEY ? (process.env.AI_STUDIO_MODEL || 'gpt-4o-mini') : null,
            monthlyBudgetUsd: Number(process.env.AI_STUDIO_MONTHLY_BUDGET_USD) || null,
            monthToDate: {
                estimatedCostUsd: Number(usage._sum.estimatedCost || 0),
                inputTokens: usage._sum.inputTokens || 0,
                outputTokens: usage._sum.outputTokens || 0,
                requests: usage._count._all
            },
            jobs: { queued: queuedJobs, generating: activeJobs, completed: completedJobs, failed: failedJobs }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const listAiStudioJobs = async (req, res) => {
    try {
        const jobs = await prisma.aiProductionJob.findMany({
            orderBy: { createdAt: 'desc' },
            take: Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50)),
            include: { course: { select: { id: true, title: true, status: true } }, createdBy: { select: { id: true, name: true } } }
        });
        res.json({ success: true, jobs: jobs.map(job => ({ ...job, _id: job.id, course: job.course ? { ...job.course, _id: job.course.id } : null })) });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createCourseGenerationJob = async (req, res) => {
    const input = req.body || {};
    const title = String(input.title || '').trim();
    const category = String(input.category || '').trim();
    const moduleCount = Number(input.moduleCount);
    const lessonCount = Number(input.lessonCount);
    const durationHours = Number(input.durationHours);
    if (!title || !category || !Number.isInteger(moduleCount) || moduleCount < 1 || moduleCount > 12
        || !Number.isInteger(lessonCount) || lessonCount < moduleCount || lessonCount > 48
        || !Number.isFinite(durationHours) || durationHours < 1 || durationHours > 500) {
        return res.status(400).json({ success: false, message: 'Provide a title, category, duration (1-500 hours), 1-12 modules, and 1-48 lessons (at least one per module).' });
    }
    if (!process.env.AI_STUDIO_API_KEY) {
        return res.status(503).json({ success: false, message: 'Course generation is unavailable until AI_STUDIO_API_KEY is configured on the backend.' });
    }
    try {
        const budget = Number(process.env.AI_STUDIO_MONTHLY_BUDGET_USD);
        const inputRate = Number(process.env.AI_STUDIO_INPUT_COST_PER_MILLION);
        const outputRate = Number(process.env.AI_STUDIO_OUTPUT_COST_PER_MILLION);
        let estimatedCost = null;
        if (Number.isFinite(budget) && budget > 0) {
            if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate) || inputRate < 0 || outputRate < 0) {
                return res.status(503).json({ success: false, message: 'A monthly budget is configured, but provider token pricing is missing. Configure AI_STUDIO_INPUT_COST_PER_MILLION and AI_STUDIO_OUTPUT_COST_PER_MILLION before queueing work.' });
            }
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);
            const estimatedInputTokens = Math.ceil(JSON.stringify(input).length / 4) + 600;
            const estimatedOutputTokens = lessonCount * 1200 + moduleCount * 700 + 2500;
            estimatedCost = (estimatedInputTokens * inputRate + estimatedOutputTokens * outputRate) / 1_000_000;
            const [spent, queued] = await Promise.all([
                prisma.aiUsageRecord.aggregate({ where: { createdAt: { gte: monthStart } }, _sum: { estimatedCost: true } }),
                prisma.aiProductionJob.aggregate({ where: { status: { in: ['queued', 'generating'] }, createdAt: { gte: monthStart } }, _sum: { estimatedCost: true } })
            ]);
            const committed = Number(spent._sum.estimatedCost || 0) + Number(queued._sum.estimatedCost || 0);
            if (committed + estimatedCost > budget) {
                return res.status(429).json({ success: false, message: `This job is estimated at $${estimatedCost.toFixed(4)} and would exceed the configured monthly AI budget.` });
            }
        }
        const safeInput = {
            title: title.slice(0, 180),
            category: category.slice(0, 80),
            subtitle: String(input.subtitle || '').slice(0, 300),
            level: ['beginner', 'intermediate', 'advanced'].includes(input.level) ? input.level : 'beginner',
            targetAudience: String(input.targetAudience || '').slice(0, 1000),
            durationHours,
            language: String(input.language || 'English').slice(0, 80),
            objectives: String(input.objectives || '').slice(0, 4000),
            skills: String(input.skills || '').slice(0, 2000),
            learningFormat: String(input.learningFormat || '').slice(0, 300),
            moduleCount,
            lessonCount,
            prerequisites: String(input.prerequisites || '').slice(0, 2000),
            certificateEligible: Boolean(input.certificateEligible),
            additionalInstructions: String(input.additionalInstructions || '').slice(0, 4000)
        };
        const job = await prisma.aiProductionJob.create({
            data: {
                createdById: req.user.id,
                input: safeInput,
                provider: process.env.AI_STUDIO_PROVIDER || 'openai-compatible',
                model: process.env.AI_STUDIO_MODEL || 'gpt-4o-mini',
                estimatedCost
            }
        });
        res.status(202).json({ success: true, job: { ...job, _id: job.id }, message: 'Course generation queued. The job will remain available after refresh.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const retryAiStudioJob = async (req, res) => {
    try {
        const job = await prisma.aiProductionJob.findUnique({ where: { id: req.params.id } });
        if (!job) return res.status(404).json({ success: false, message: 'Production job not found' });
        if (job.status !== 'failed') return res.status(409).json({ success: false, message: 'Only failed jobs can be retried' });
        if (!process.env.AI_STUDIO_API_KEY) return res.status(503).json({ success: false, message: 'Configure AI_STUDIO_API_KEY before retrying this job.' });
        const updated = await prisma.aiProductionJob.update({
            where: { id: job.id },
            data: { status: 'queued', phase: 'queued', progress: 0, error: null, attemptCount: 0, completedAt: null }
        });
        res.json({ success: true, job: { ...updated, _id: updated.id } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAiStudioUsage = async (req, res) => {
    try {
        const records = await prisma.aiUsageRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
        res.json({ success: true, records });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getAiStudioStatus, listAiStudioJobs, createCourseGenerationJob, retryAiStudioJob, getAiStudioUsage };