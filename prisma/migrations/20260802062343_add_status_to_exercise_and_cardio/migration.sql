-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('Assigned', 'Completed', 'Skipped');

-- AlterTable
ALTER TABLE "Cardio" ADD COLUMN     "status" "ActivityStatus" NOT NULL DEFAULT 'Assigned';

-- AlterTable
ALTER TABLE "Exercise" ADD COLUMN     "status" "ActivityStatus" NOT NULL DEFAULT 'Assigned';
