-- Dev-only destructive migration: the new WorkoutStatus graph reuses
-- 'PendingApproval' and 'TrainerRejected' for different pipeline stages
-- than the old graph used them for, so no ALTER TYPE ... RENAME VALUE
-- sequence can express this without silently mislabeling existing rows.
-- Existing Workout rows (and their cascaded Exercise/ExerciseSet rows)
-- are wiped instead.
DELETE FROM "Workout";

-- AlterTable: drop the old-typed column so the enum type can be dropped
ALTER TABLE "Workout" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Workout" DROP COLUMN "status";

DROP TYPE "WorkoutStatus";

CREATE TYPE "WorkoutStatus" AS ENUM (
  'PendingApproval',
  'TrainerApproved',
  'TrainerRejected',
  'TrainerSubmitted',
  'Completed',
  'ClientRejected',
  'Cancelled'
);

ALTER TABLE "Workout" ADD COLUMN "status" "WorkoutStatus" NOT NULL DEFAULT 'PendingApproval';

-- AlterEnum: collapse the four Workout-specific NotificationType values
-- into one ('type' carries no branching logic anywhere — backend only
-- stores/returns it, mobile only displays title/body — entityType +
-- entityId already identify the specific record).
DELETE FROM "Notification"
WHERE "type" IN ('WorkoutBooked', 'WorkoutConfirmed', 'WorkoutCancelled', 'WorkoutPendingApproval');

ALTER TABLE "Notification" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE TEXT;

DROP TYPE "NotificationType";

CREATE TYPE "NotificationType" AS ENUM (
  'Workout',
  'ClientTrainerRequest',
  'ClientTrainerAccepted',
  'NewReview',
  'NewMessage'
);

ALTER TABLE "Notification" ALTER COLUMN "type" TYPE "NotificationType" USING ("type"::"NotificationType");
