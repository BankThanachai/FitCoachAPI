-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailResendAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN     "phoneResendAttempts" INTEGER NOT NULL DEFAULT 0;
