const prisma = require('../utils/prisma');

const providerConfig = () => ({
    apiKey: process.env.AI_STUDIO_API_KEY,
    baseUrl: (process.env.AI_STUDIO_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_STUDIO_MODEL || 'gpt-4o-mini',
    provider: process.env.AI_STUDIO_PROVIDER || 'openai-compatible'
});

const makeCoursePrompt = input => `Create a complete, original online course as strict JSON. Do not wrap JSON in markdown. Return keys: title, subtitle, description, overview, category, level, targetAudience, durationHours, language, objectives (array), outcomes (array), requirements (array), prerequisites (array), completionRequirements (array), modules (array). Each module has title, description, lessons (array). Each lesson has title, description, durationMinutes, objectives (array), teachingContent, narrationScript, demonstrationInstructions, examples (array), exercises (array), keyTakeaways (array), quiz (array of {question, options, correctAnswer, explanation, difficulty, points}), assignment, resources (array). Keep content factual in tone and identify any uncertainty rather than inventing citations. Create ${input.moduleCount} modules and approximately ${input.lessonCount} lessons total. Course request: ${JSON.stringify(input)}`;

const calculateCost = usage => {
    const inputRate = Number(process.env.AI_STUDIO_INPUT_COST_PER_MILLION);
    const outputRate = Number(process.env.AI_STUDIO_OUTPUT_COST_PER_MILLION);
    if (!Number.isFinite(inputRate) || !Number.isFinite(outputRate)) return null;
    return (usage.prompt_tokens * inputRate + usage.completion_tokens * outputRate) / 1_000_000;
};

const updateJob = (id, data) => prisma.aiProductionJob.update({ where: { id }, data });

const handleJob = async job => {
    const config = providerConfig();
    let usageData = { inputTokens: 0, outputTokens: 0, estimatedCost: null, status: 'failed', error: null };
    try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.model,
                temperature: 0.4,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: 'You are an instructional designer. Produce rigorous, teachable course material. Return valid JSON only.' },
                    { role: 'user', content: makeCoursePrompt(job.input) }
                ]
            }),
            signal: AbortSignal.timeout(180000)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || `AI provider request failed (${response.status})`);
        const content = result.choices?.[0]?.message?.content;
        if (!content) throw new Error('AI provider returned an empty course response');
        const courseData = JSON.parse(content);
        if (!courseData.title || !courseData.description || !Array.isArray(courseData.modules) || !courseData.modules.length) {
            throw new Error('AI response is missing required course fields or modules');
        }
        const lessons = courseData.modules.flatMap((module, moduleIndex) =>
            (Array.isArray(module.lessons) ? module.lessons : []).map((lesson, lessonIndex) => ({
                ...lesson,
                moduleTitle: String(module.title || `Module ${moduleIndex + 1}`),
                moduleIndex,
                lessonIndex
            }))
        );
        if (!lessons.length) throw new Error('AI response did not contain any lessons');

        await updateJob(job.id, { phase: 'saving_draft', progress: 85 });
        const course = await prisma.course.create({
            data: {
                title: String(courseData.title).slice(0, 180),
                description: String(courseData.description),
                shortDescription: courseData.subtitle ? String(courseData.subtitle).slice(0, 300) : null,
                price: 0,
                category: String(courseData.category || job.input.category || 'other').slice(0, 80),
                level: String(courseData.level || job.input.level || 'beginner').toLowerCase(),
                duration: Number(courseData.durationHours || job.input.durationHours) || null,
                lessons,
                certificateEligible: job.input.certificateEligible !== false,
                instructorId: job.createdById,
                instructorName: (await prisma.user.findUnique({ where: { id: job.createdById }, select: { name: true } }))?.name || 'SkillHub Admin',
                status: 'pending',
                tags: Array.isArray(courseData.objectives) ? courseData.objectives.slice(0, 12).map(value => String(value).slice(0, 60)) : []
            }
        });
        usageData = {
            inputTokens: Number(result.usage?.prompt_tokens) || 0,
            outputTokens: Number(result.usage?.completion_tokens) || 0,
            estimatedCost: calculateCost(result.usage || {}),
            status: 'succeeded',
            error: null
        };
        await prisma.aiUsageRecord.create({ data: {
            jobId: job.id,
            userId: job.createdById,
            provider: config.provider,
            model: config.model,
            operation: 'course_generation',
            ...usageData
        } });
        await updateJob(job.id, {
            courseId: course.id,
            output: courseData,
            status: 'completed',
            phase: 'awaiting_review',
            progress: 100,
            provider: config.provider,
            model: config.model,
            estimatedCost: usageData.estimatedCost,
            completedAt: new Date(),
            error: null
        });
    } catch (error) {
        usageData.error = String(error.message || 'AI generation failed').slice(0, 1000);
        await prisma.aiUsageRecord.create({ data: {
            jobId: job.id,
            userId: job.createdById,
            provider: config.provider,
            model: config.model,
            operation: 'course_generation',
            ...usageData
        } }).catch(() => {});
        await updateJob(job.id, {
            status: 'failed',
            phase: 'failed',
            error: usageData.error,
            provider: config.provider,
            model: config.model,
            completedAt: new Date()
        });
    }
};

let running = false;
let timer;

const processNextJob = async () => {
    if (running || !providerConfig().apiKey) return;
    running = true;
    try {
        const next = await prisma.aiProductionJob.findFirst({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } });
        if (!next) return;
        const claim = await prisma.aiProductionJob.updateMany({
            where: { id: next.id, status: 'queued' },
            data: { status: 'generating', phase: 'generating_course', progress: 15, startedAt: new Date(), attemptCount: { increment: 1 }, error: null }
        });
        if (claim.count) await handleJob(next);
    } catch (error) {
        console.error(`AI Studio worker error: ${error.message}`);
    } finally {
        running = false;
    }
};

const startAiStudioWorker = async () => {
    await prisma.aiProductionJob.updateMany({
        where: { status: 'generating' },
        data: { status: 'queued', phase: 'queued', progress: 0, error: 'Worker restarted; job returned to queue.' }
    });
    timer = setInterval(processNextJob, 2000);
    timer.unref?.();
    processNextJob();
};

module.exports = { startAiStudioWorker };