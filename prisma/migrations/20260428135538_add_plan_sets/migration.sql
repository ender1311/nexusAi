-- CreateTable
CREATE TABLE "PlanSet" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "collectionId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "personaTag" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanSetMember" (
    "planId" TEXT NOT NULL,
    "setId" TEXT NOT NULL,

    CONSTRAINT "PlanSetMember_pkey" PRIMARY KEY ("planId","setId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanSet_setId_key" ON "PlanSet"("setId");

-- CreateIndex
CREATE INDEX "PlanSetMember_planId_idx" ON "PlanSetMember"("planId");

-- AddForeignKey
ALTER TABLE "PlanSetMember" ADD CONSTRAINT "PlanSetMember_setId_fkey" FOREIGN KEY ("setId") REFERENCES "PlanSet"("setId") ON DELETE CASCADE ON UPDATE CASCADE;
