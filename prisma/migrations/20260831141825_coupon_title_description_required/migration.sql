-- Backfill existing rows before enforcing NOT NULL
UPDATE "Coupon" SET "title" = 'คูปอง' WHERE "title" IS NULL;
UPDATE "Coupon" SET "description" = '' WHERE "description" IS NULL;

-- AlterTable
ALTER TABLE "Coupon" ALTER COLUMN "title" SET NOT NULL;
ALTER TABLE "Coupon" ALTER COLUMN "description" SET NOT NULL;
