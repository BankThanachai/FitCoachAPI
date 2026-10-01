-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailOtpLockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN     "phoneOtpLockedUntil" TIMESTAMP(3);
