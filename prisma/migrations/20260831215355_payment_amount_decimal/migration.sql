-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "amountSatang",
ADD COLUMN     "amount" DECIMAL(65,30) NOT NULL;

-- AlterTable
ALTER TABLE "PaymentRefund" DROP COLUMN "amountSatang",
ADD COLUMN     "amount" DECIMAL(65,30) NOT NULL;

