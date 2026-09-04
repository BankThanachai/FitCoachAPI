-- DropForeignKey
ALTER TABLE "Review" DROP CONSTRAINT "Review_purchaseId_fkey";

-- DropIndex
DROP INDEX "Review_purchaseId_key";

-- AlterTable
ALTER TABLE "Review" DROP COLUMN "purchaseId";
