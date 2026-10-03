-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('Active', 'Inactive');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'Active',
ADD COLUMN     "deactivatedAt" TIMESTAMP(3);

-- email and phone only have to be unique among Active users, so an account
-- that was deactivated (soft-deleted) frees its email/phone for a new
-- registration. Prisma can't declare a partial unique index in the schema, so
-- these replace the plain unique indexes here and nowhere else.
DROP INDEX "User_email_key";
DROP INDEX "User_phone_key";
CREATE UNIQUE INDEX "User_email_active_key" ON "User"("email") WHERE "status" = 'Active';
CREATE UNIQUE INDEX "User_phone_active_key" ON "User"("phone") WHERE "status" = 'Active';
