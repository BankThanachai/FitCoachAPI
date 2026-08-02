-- CreateTable
CREATE TABLE "CardioActivity" (
    "id" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "kcal" INTEGER NOT NULL,
    "avgHeartRate" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "distanceKm" DECIMAL(65,30),
    "route" TEXT,
    "assignedToId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardioActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CardioActivity_assignedToId_idx" ON "CardioActivity"("assignedToId");

-- CreateIndex
CREATE INDEX "CardioActivity_createdById_idx" ON "CardioActivity"("createdById");

-- AddForeignKey
ALTER TABLE "CardioActivity" ADD CONSTRAINT "CardioActivity_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardioActivity" ADD CONSTRAINT "CardioActivity_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
