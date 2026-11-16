CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL,
    "visitorKey" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "deviceType" TEXT NOT NULL,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteVisit_createdAt_idx" ON "SiteVisit"("createdAt");
CREATE INDEX "SiteVisit_visitorKey_createdAt_idx" ON "SiteVisit"("visitorKey", "createdAt");
CREATE INDEX "SiteVisit_path_createdAt_idx" ON "SiteVisit"("path", "createdAt");