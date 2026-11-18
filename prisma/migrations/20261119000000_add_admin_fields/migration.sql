-- Add adminRole and adminPermissions columns to User table if they don't exist
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminRole" TEXT DEFAULT 'super_admin';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "adminPermissions" JSONB NOT NULL DEFAULT '[]';
