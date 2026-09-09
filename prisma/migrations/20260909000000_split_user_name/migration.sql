-- AlterTable: add new columns
ALTER TABLE "User" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT;

-- Backfill: split existing "name" on the first space into firstName/lastName.
-- A name with no space (e.g. "Client B" has one, but a single-word name would)
-- goes entirely into firstName, leaving lastName null.
UPDATE "User"
SET
  "firstName" = split_part("name", ' ', 1),
  "lastName" = NULLIF(substring("name" FROM position(' ' IN "name") + 1), '')
WHERE "name" IS NOT NULL;

-- DropColumn
ALTER TABLE "User" DROP COLUMN "name";
