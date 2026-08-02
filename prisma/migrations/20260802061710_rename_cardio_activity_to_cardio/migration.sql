-- RenameTable
ALTER TABLE "CardioActivity" RENAME TO "Cardio";

-- RenameForeignKey
ALTER TABLE "Cardio" RENAME CONSTRAINT "CardioActivity_assignedToId_fkey" TO "Cardio_assignedToId_fkey";

-- RenameForeignKey
ALTER TABLE "Cardio" RENAME CONSTRAINT "CardioActivity_createdById_fkey" TO "Cardio_createdById_fkey";

-- RenameIndex
ALTER INDEX "CardioActivity_pkey" RENAME TO "Cardio_pkey";

-- RenameIndex
ALTER INDEX "CardioActivity_assignedToId_idx" RENAME TO "Cardio_assignedToId_idx";

-- RenameIndex
ALTER INDEX "CardioActivity_createdById_idx" RENAME TO "Cardio_createdById_idx";
