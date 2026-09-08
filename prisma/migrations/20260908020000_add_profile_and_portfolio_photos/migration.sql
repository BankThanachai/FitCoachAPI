-- AlterTable
ALTER TABLE "User" ADD COLUMN     "profilePhotoKey" TEXT;

-- CreateTable
CREATE TABLE "TrainerPortfolioPhoto" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainerPortfolioPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrainerPortfolioPhoto_trainerId_idx" ON "TrainerPortfolioPhoto"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainerPortfolioPhoto_trainerId_order_key" ON "TrainerPortfolioPhoto"("trainerId", "order");

-- AddForeignKey
ALTER TABLE "TrainerPortfolioPhoto" ADD CONSTRAINT "TrainerPortfolioPhoto_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
