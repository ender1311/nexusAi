-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hasRecurringGiftYouversion" BOOLEAN;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "giftAmountMaximumTimestamp" TIMESTAMP(3);
