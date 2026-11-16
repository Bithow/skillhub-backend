CREATE TABLE "AiProductionJob" (
    "id" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "courseId" TEXT,
    "jobType" TEXT NOT NULL DEFAULT 'course_generation',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phase" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "provider" TEXT,
    "model" TEXT,
    "estimatedCost" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiProductionJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiProductionJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "AiProductionJob_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "AiUsageRecord" (
    "id" TEXT NOT NULL,
    "jobId" TEXT,
    "userId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DOUBLE PRECISION,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiUsageRecord_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AiUsageRecord_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "AiProductionJob"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "AiUsageRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "AiProductionJob_status_createdAt_idx" ON "AiProductionJob"("status", "createdAt");
CREATE INDEX "AiProductionJob_createdById_createdAt_idx" ON "AiProductionJob"("createdById", "createdAt");
CREATE INDEX "AiProductionJob_courseId_idx" ON "AiProductionJob"("courseId");
CREATE INDEX "AiUsageRecord_createdAt_status_idx" ON "AiUsageRecord"("createdAt", "status");
CREATE INDEX "AiUsageRecord_jobId_idx" ON "AiUsageRecord"("jobId");