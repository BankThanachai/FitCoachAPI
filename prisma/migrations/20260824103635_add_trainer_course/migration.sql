-- CreateTable
CREATE TABLE "TrainerCourse" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "hours" INTEGER NOT NULL,
    "price" DECIMAL(65,30) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainerCourse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainerCourse_trainerId_idx" ON "TrainerCourse"("trainerId");

-- AddForeignKey
ALTER TABLE "TrainerCourse" ADD CONSTRAINT "TrainerCourse_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
