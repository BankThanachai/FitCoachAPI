-- DropIndex
DROP INDEX "ClientTrainer_clientId_trainerId_key";

-- CreateIndex
CREATE INDEX "ClientTrainer_clientId_trainerId_idx" ON "ClientTrainer"("clientId", "trainerId");
