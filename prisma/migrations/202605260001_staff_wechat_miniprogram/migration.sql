ALTER TABLE "StaffMember" ADD COLUMN "miniProgramCode" TEXT;
ALTER TABLE "StaffMember" ADD COLUMN "wechatOpenId" TEXT;
ALTER TABLE "StaffMember" ADD COLUMN "wechatNotificationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StaffMember" ADD COLUMN "wechatSubscribedAt" DATETIME;
ALTER TABLE "StaffMember" ADD COLUMN "wechatBoundAt" DATETIME;

CREATE UNIQUE INDEX "StaffMember_miniProgramCode_key" ON "StaffMember"("miniProgramCode");
CREATE UNIQUE INDEX "StaffMember_wechatOpenId_key" ON "StaffMember"("wechatOpenId");
CREATE INDEX "StaffMember_miniProgramCode_idx" ON "StaffMember"("miniProgramCode");
CREATE INDEX "StaffMember_wechatOpenId_idx" ON "StaffMember"("wechatOpenId");
