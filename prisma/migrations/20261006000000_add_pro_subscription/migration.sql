-- CreateEnum
CREATE TYPE "SubscriptionStore" AS ENUM ('APP_STORE', 'PLAY_STORE', 'OTHER');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'BILLING_RETRY', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPro" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "store" "SubscriptionStore" NOT NULL,
    "productId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "originalTransactionId" TEXT,
    "environment" "SubscriptionEnvironment" NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_expiresAt_idx" ON "Subscription"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionEvent_eventId_key" ON "SubscriptionEvent"("eventId");

-- CreateIndex
CREATE INDEX "SubscriptionEvent_userId_idx" ON "SubscriptionEvent"("userId");

-- CreateIndex
CREATE INDEX "User_type_isPro_rating_reviewCount_idx" ON "User"("type", "isPro", "rating", "reviewCount");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionEvent" ADD CONSTRAINT "SubscriptionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: User.rating was never written by any code path (always 0), so
-- seed it, and the new reviewCount, from the reviews each trainer already
-- has. Rounded to 2 places to match roundScore() in src/shared/score.util.ts.
UPDATE "User" u
SET "rating" = ROUND(r.avg_score, 2)::double precision,
    "reviewCount" = r.review_count
FROM (
    SELECT "targetUserId", AVG("score") AS avg_score, COUNT(*)::int AS review_count
    FROM "Review"
    GROUP BY "targetUserId"
) r
WHERE u."id" = r."targetUserId";
