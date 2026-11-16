ALTER TABLE "Transaction"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN "isSimulated" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "FinancialLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "transactionId" TEXT,
    "account" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FinancialLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FinancialLedgerEntry_userId_createdAt_idx" ON "FinancialLedgerEntry"("userId", "createdAt");
CREATE INDEX "FinancialLedgerEntry_account_status_createdAt_idx" ON "FinancialLedgerEntry"("account", "status", "createdAt");
CREATE INDEX "FinancialLedgerEntry_transactionId_idx" ON "FinancialLedgerEntry"("transactionId");
CREATE INDEX "FinancialLedgerEntry_relatedType_relatedId_idx" ON "FinancialLedgerEntry"("relatedType", "relatedId");

ALTER TABLE "FinancialLedgerEntry"
ADD CONSTRAINT "FinancialLedgerEntry_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinancialLedgerEntry"
ADD CONSTRAINT "FinancialLedgerEntry_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "FinancialLedgerEntry" (
    "id", "userId", "transactionId", "account", "entryType", "amount", "currency",
    "status", "isSimulated", "relatedType", "relatedId", "metadata", "createdAt"
)
SELECT
    'legacy_course_volume_' || t."id", t."userId", t."id", 'course_payment_recorded',
    'course_payment_volume', t."amount", COALESCE(t."currency", 'USD'), 'verified', false,
    'course', COALESCE(t."courseId", t."metadata"->>'courseId'),
    jsonb_build_object('legacyBackfill', true), t."createdAt"
FROM "Transaction" t
WHERE t."type" = 'course_purchase' AND t."status" = 'completed' AND t."isSimulated" = false;

INSERT INTO "FinancialLedgerEntry" (
    "id", "userId", "transactionId", "account", "entryType", "amount", "currency",
    "status", "isSimulated", "relatedType", "relatedId", "metadata", "createdAt"
)
SELECT
    'legacy_instructor_earning_' || t."id", c."instructorId", t."id", 'instructor_earnings',
    'course_earning', t."netAmount", COALESCE(t."currency", 'USD'), 'eligible', false,
    'course', c."id", jsonb_build_object('legacyBackfill', true), t."createdAt"
FROM "Transaction" t
JOIN "Course" c ON c."id" = COALESCE(t."courseId", t."metadata"->>'courseId')
WHERE t."type" = 'course_purchase' AND t."status" = 'completed' AND t."isSimulated" = false;

INSERT INTO "FinancialLedgerEntry" (
    "id", "transactionId", "account", "entryType", "amount", "currency", "status",
    "isSimulated", "relatedType", "relatedId", "metadata", "createdAt"
)
SELECT
    'legacy_skillhub_commission_' || t."id", t."id", 'skillhub_revenue', 'course_commission',
    t."commission", COALESCE(t."currency", 'USD'), 'recorded', false, 'course',
    COALESCE(t."courseId", t."metadata"->>'courseId'), jsonb_build_object('legacyBackfill', true), t."createdAt"
FROM "Transaction" t
WHERE t."type" = 'course_purchase' AND t."status" = 'completed' AND t."isSimulated" = false AND t."commission" > 0;