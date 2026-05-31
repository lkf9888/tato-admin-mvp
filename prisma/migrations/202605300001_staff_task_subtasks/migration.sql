ALTER TABLE "StaffTask" ADD COLUMN "parentTaskId" TEXT;

CREATE INDEX "StaffTask_parentTaskId_sortOrder_idx" ON "StaffTask"("parentTaskId", "sortOrder");
