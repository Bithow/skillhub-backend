CREATE TABLE "ChatTyping" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatTyping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatTyping_senderId_receiverId_key" ON "ChatTyping"("senderId", "receiverId");
CREATE INDEX "ChatTyping_receiverId_expiresAt_idx" ON "ChatTyping"("receiverId", "expiresAt");

ALTER TABLE "ChatTyping" ADD CONSTRAINT "ChatTyping_senderId_fkey"
FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatTyping" ADD CONSTRAINT "ChatTyping_receiverId_fkey"
FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
