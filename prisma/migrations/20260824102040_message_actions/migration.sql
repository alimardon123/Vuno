-- AlterTable
ALTER TABLE "Event" ADD COLUMN "targetEventId" TEXT;

-- CreateIndex
CREATE INDEX "Event_orgId_targetEventId_idx" ON "Event"("orgId", "targetEventId");
