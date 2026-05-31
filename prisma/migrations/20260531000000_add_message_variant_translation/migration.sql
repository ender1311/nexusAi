-- AlterTable
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "localizePush" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MessageVariantTranslation" (
    "id" TEXT NOT NULL,
    "messageVariantId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "bodyPersonal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageVariantTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "MessageVariantTranslation_messageVariantId_language_key" ON "MessageVariantTranslation"("messageVariantId", "language");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MessageVariantTranslation_messageVariantId_status_idx" ON "MessageVariantTranslation"("messageVariantId", "status");

-- AddForeignKey
ALTER TABLE "MessageVariantTranslation" DROP CONSTRAINT IF EXISTS "MessageVariantTranslation_messageVariantId_fkey";
ALTER TABLE "MessageVariantTranslation" ADD CONSTRAINT "MessageVariantTranslation_messageVariantId_fkey" FOREIGN KEY ("messageVariantId") REFERENCES "MessageVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
