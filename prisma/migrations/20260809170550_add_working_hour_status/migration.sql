-- CreateEnum
CREATE TYPE "WorkingHourStatus" AS ENUM ('Active', 'Inactive');

-- AlterTable
ALTER TABLE "WorkingHour" ADD COLUMN     "status" "WorkingHourStatus" NOT NULL DEFAULT 'Active';
