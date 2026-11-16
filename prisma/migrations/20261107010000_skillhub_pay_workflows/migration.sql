CREATE TABLE "FreelanceProject" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "freelancerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "budget" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "commissionPercent" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "freelancerNetAmount" DOUBLE PRECISION NOT NULL,
    "paymentArrangement" TEXT NOT NULL DEFAULT 'direct_external',
    "milestones" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'active',
    "completionStatus" TEXT NOT NULL DEFAULT 'not_started',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FreelanceProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FreelancePaymentReport" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "paymentMethodDescription" TEXT NOT NULL,
    "transactionReference" TEXT,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'awaiting_client',
    "clientResponse" TEXT,
    "adminNote" TEXT,
    "commissionPercent" DOUBLE PRECISION NOT NULL,
    "commissionAmount" DOUBLE PRECISION NOT NULL,
    "freelancerNetAmount" DOUBLE PRECISION NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FreelancePaymentReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "adminNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WithdrawalRequest" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "payoutMethod" TEXT NOT NULL,
    "destinationMasked" TEXT,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "decisionReason" TEXT,
    "adminNote" TEXT,
    "payoutReference" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT true,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WithdrawalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FreelanceProject_reference_key" ON "FreelanceProject"("reference");
CREATE INDEX "FreelanceProject_clientId_status_createdAt_idx" ON "FreelanceProject"("clientId", "status", "createdAt");
CREATE INDEX "FreelanceProject_freelancerId_status_createdAt_idx" ON "FreelanceProject"("freelancerId", "status", "createdAt");
CREATE UNIQUE INDEX "FreelancePaymentReport_reference_key" ON "FreelancePaymentReport"("reference");
CREATE INDEX "FreelancePaymentReport_projectId_status_reportedAt_idx" ON "FreelancePaymentReport"("projectId", "status", "reportedAt");
CREATE INDEX "FreelancePaymentReport_reporterId_reportedAt_idx" ON "FreelancePaymentReport"("reporterId", "reportedAt");
CREATE INDEX "FreelancePaymentReport_status_reportedAt_idx" ON "FreelancePaymentReport"("status", "reportedAt");
CREATE UNIQUE INDEX "RefundRequest_reference_key" ON "RefundRequest"("reference");
CREATE INDEX "RefundRequest_userId_status_createdAt_idx" ON "RefundRequest"("userId", "status", "createdAt");
CREATE INDEX "RefundRequest_status_createdAt_idx" ON "RefundRequest"("status", "createdAt");
CREATE UNIQUE INDEX "WithdrawalRequest_reference_key" ON "WithdrawalRequest"("reference");
CREATE INDEX "WithdrawalRequest_userId_status_createdAt_idx" ON "WithdrawalRequest"("userId", "status", "createdAt");
CREATE INDEX "WithdrawalRequest_status_createdAt_idx" ON "WithdrawalRequest"("status", "createdAt");

ALTER TABLE "FreelanceProject" ADD CONSTRAINT "FreelanceProject_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FreelanceProject" ADD CONSTRAINT "FreelanceProject_freelancerId_fkey"
FOREIGN KEY ("freelancerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FreelancePaymentReport" ADD CONSTRAINT "FreelancePaymentReport_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "FreelanceProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FreelancePaymentReport" ADD CONSTRAINT "FreelancePaymentReport_reporterId_fkey"
FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WithdrawalRequest" ADD CONSTRAINT "WithdrawalRequest_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;