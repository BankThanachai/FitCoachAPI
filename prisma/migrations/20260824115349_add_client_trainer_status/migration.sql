-- CreateEnum
CREATE TYPE "ClientTrainerStatus" AS ENUM ('Pending', 'Accepted', 'Rejected');

-- AlterTable
ALTER TABLE "ClientTrainer" ADD COLUMN     "status" "ClientTrainerStatus" NOT NULL DEFAULT 'Pending';
