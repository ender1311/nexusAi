-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "fallbackSendHour" INTEGER;

-- AlterTable
ALTER TABLE "UserDecision" ADD COLUMN "scheduledFor" TIMESTAMP(3);
