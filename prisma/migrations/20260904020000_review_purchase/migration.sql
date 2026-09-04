-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "purchaseId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Review_purchaseId_key" ON "Review"("purchaseId");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "CoursePurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
