-- RenameTable
ALTER TABLE "Friendship" RENAME TO "ClientTrainer";

-- RenameColumn
ALTER TABLE "ClientTrainer" RENAME COLUMN "userAId" TO "clientId";
ALTER TABLE "ClientTrainer" RENAME COLUMN "userBId" TO "trainerId";

-- RenameForeignKey
ALTER TABLE "ClientTrainer" RENAME CONSTRAINT "Friendship_userAId_fkey" TO "ClientTrainer_clientId_fkey";

-- RenameForeignKey
ALTER TABLE "ClientTrainer" RENAME CONSTRAINT "Friendship_userBId_fkey" TO "ClientTrainer_trainerId_fkey";

-- RenameIndex
ALTER INDEX "Friendship_pkey" RENAME TO "ClientTrainer_pkey";

-- RenameIndex
ALTER INDEX "Friendship_userAId_userBId_key" RENAME TO "ClientTrainer_clientId_trainerId_key";

-- RenameIndex
ALTER INDEX "Friendship_userBId_idx" RENAME TO "ClientTrainer_trainerId_idx";
