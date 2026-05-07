-- AlterTable: add subcategory to MessageVariant
ALTER TABLE "MessageVariant" ADD COLUMN "subcategory" TEXT;

-- CreateTable: Deeplink
CREATE TABLE "Deeplink" (
    "id" TEXT NOT NULL,
    "wayfinderId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "urlTemplate" TEXT NOT NULL,
    "example" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Deeplink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deeplink_wayfinderId_key" ON "Deeplink"("wayfinderId");
