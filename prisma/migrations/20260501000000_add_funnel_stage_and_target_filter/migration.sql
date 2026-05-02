-- CreateEnum
CREATE TYPE "FunnelStage" AS ENUM ('new', 'lapsed', 'connected', 'activated', 'engaged', 'inspired');

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "funnelStage" "FunnelStage" NOT NULL DEFAULT 'connected',
ADD COLUMN "targetFilter" JSONB;
