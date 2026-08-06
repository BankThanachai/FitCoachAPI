-- AlterTable
ALTER TABLE "User" ADD COLUMN     "district" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "province" TEXT,
ADD COLUMN     "subDistrict" TEXT;

-- Backfill existing rows with placeholder
UPDATE "User" SET
  "district" = '',
  "postalCode" = '',
  "province" = '',
  "subDistrict" = ''
WHERE "district" IS NULL;

-- Enforce NOT NULL now that existing rows are backfilled
ALTER TABLE "User"
  ALTER COLUMN "district" SET NOT NULL,
  ALTER COLUMN "postalCode" SET NOT NULL,
  ALTER COLUMN "province" SET NOT NULL,
  ALTER COLUMN "subDistrict" SET NOT NULL;
