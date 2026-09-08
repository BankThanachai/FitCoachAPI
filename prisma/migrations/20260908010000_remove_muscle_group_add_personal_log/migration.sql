-- AlterTable
ALTER TABLE "Exercise" DROP COLUMN "muscleGroup";

-- DropEnum
DROP TYPE "MuscleGroup";

-- CreateTable
CREATE TABLE "PersonalLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalLogExercise" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personalLogId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalLogExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalLogExerciseSet" (
    "id" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "weightKg" DECIMAL(65,30),
    "reps" INTEGER NOT NULL,
    "personalLogExerciseId" TEXT NOT NULL,

    CONSTRAINT "PersonalLogExerciseSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PersonalLog_clientId_idx" ON "PersonalLog"("clientId");

-- CreateIndex
CREATE INDEX "PersonalLogExercise_personalLogId_idx" ON "PersonalLogExercise"("personalLogId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalLogExerciseSet_personalLogExerciseId_order_key" ON "PersonalLogExerciseSet"("personalLogExerciseId", "order");

-- AddForeignKey
ALTER TABLE "PersonalLog" ADD CONSTRAINT "PersonalLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalLogExercise" ADD CONSTRAINT "PersonalLogExercise_personalLogId_fkey" FOREIGN KEY ("personalLogId") REFERENCES "PersonalLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalLogExerciseSet" ADD CONSTRAINT "PersonalLogExerciseSet_personalLogExerciseId_fkey" FOREIGN KEY ("personalLogExerciseId") REFERENCES "PersonalLogExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
