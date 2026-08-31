-- DropForeignKey
ALTER TABLE "Workout" DROP CONSTRAINT "Workout_courseId_fkey";

-- DropForeignKey
ALTER TABLE "WorkoutCoupon" DROP CONSTRAINT "WorkoutCoupon_couponId_fkey";

-- DropForeignKey
ALTER TABLE "WorkoutCoupon" DROP CONSTRAINT "WorkoutCoupon_workoutId_fkey";

-- DropIndex
DROP INDEX "Workout_courseId_idx";

-- AlterTable
ALTER TABLE "Workout" DROP COLUMN "courseId",
ADD COLUMN     "purchaseId" TEXT NOT NULL;

-- DropTable
DROP TABLE "WorkoutCoupon";

-- CreateTable
CREATE TABLE "CoursePurchase" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoursePurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseCoupon" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoursePurchase_clientId_idx" ON "CoursePurchase"("clientId");

-- CreateIndex
CREATE INDEX "CoursePurchase_courseId_idx" ON "CoursePurchase"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseCoupon_couponId_key" ON "PurchaseCoupon"("couponId");

-- CreateIndex
CREATE INDEX "PurchaseCoupon_purchaseId_idx" ON "PurchaseCoupon"("purchaseId");

-- CreateIndex
CREATE INDEX "Workout_purchaseId_idx" ON "Workout"("purchaseId");

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "CoursePurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoursePurchase" ADD CONSTRAINT "CoursePurchase_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrainerCourse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseCoupon" ADD CONSTRAINT "PurchaseCoupon_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "CoursePurchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseCoupon" ADD CONSTRAINT "PurchaseCoupon_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

