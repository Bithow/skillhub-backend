CREATE TABLE "HireRequest" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "freelancerId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HireRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HireRequest_freelancerId_status_createdAt_idx"
ON "HireRequest"("freelancerId", "status", "createdAt");

CREATE INDEX "HireRequest_clientId_createdAt_idx"
ON "HireRequest"("clientId", "createdAt");

ALTER TABLE "HireRequest" ADD CONSTRAINT "HireRequest_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "HireRequest" ADD CONSTRAINT "HireRequest_freelancerId_fkey"
FOREIGN KEY ("freelancerId") REFERENCES "Freelancer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
