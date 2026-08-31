-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('Standard', 'Trial');

-- DropForeignKey
ALTER TABLE "Workout" DROP CONSTRAINT "Workout_couponId_fkey";

-- DropIndex
DROP INDEX "Workout_couponId_key";

-- AlterTable: rename+convert minHours -> minSessions (preserve data)
ALTER TABLE "Coupon" RENAME COLUMN "minHours" TO "minSessions";
ALTER TABLE "Coupon" ALTER COLUMN "minSessions" TYPE INTEGER USING ROUND("minSessions")::INTEGER;
ALTER TABLE "Coupon" ALTER COLUMN "minSessions" DROP NOT NULL;
ALTER TABLE "Coupon" ADD COLUMN "couponType" "CouponType" NOT NULL DEFAULT 'Standard';

-- AlterTable
ALTER TABLE "TrainerCourse" ADD COLUMN "isTrial" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Workout" DROP COLUMN "couponId",
ADD COLUMN "courseId" TEXT;

-- CreateTable
CREATE TABLE "WorkoutCoupon" (
    "id" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutCoupon_couponId_key" ON "WorkoutCoupon"("couponId");

-- CreateIndex
CREATE INDEX "WorkoutCoupon_workoutId_idx" ON "WorkoutCoupon"("workoutId");

-- CreateIndex
CREATE INDEX "Workout_courseId_idx" ON "Workout"("courseId");

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrainerCourse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutCoupon" ADD CONSTRAINT "WorkoutCoupon_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutCoupon" ADD CONSTRAINT "WorkoutCoupon_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
