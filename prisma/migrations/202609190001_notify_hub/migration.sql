-- CreateTable
CREATE TABLE "NotifyMiniProgram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "secretEnvVar" TEXT NOT NULL DEFAULT 'WECHAT_MINIPROGRAM_APP_SECRET',
    "state" TEXT NOT NULL DEFAULT 'formal',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NotifyTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "miniProgramId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "fieldMap" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotifyTemplate_miniProgramId_fkey" FOREIGN KEY ("miniProgramId") REFERENCES "NotifyMiniProgram" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotifyApp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "miniProgramId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotifyApp_miniProgramId_fkey" FOREIGN KEY ("miniProgramId") REFERENCES "NotifyMiniProgram" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotifyApiKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "lastUsedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotifyApiKey_appId_fkey" FOREIGN KEY ("appId") REFERENCES "NotifyApp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotifyChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bindCode" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotifyChannel_appId_fkey" FOREIGN KEY ("appId") REFERENCES "NotifyApp" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotifySubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "label" TEXT,
    "mutedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotifySubscription_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotifyChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotifySubscribeQuota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "miniProgramId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "lastGrantedAt" DATETIME,
    "lastSpentAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotifySubscribeQuota_miniProgramId_fkey" FOREIGN KEY ("miniProgramId") REFERENCES "NotifyMiniProgram" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotifyDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "appId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "payload" TEXT NOT NULL,
    "page" TEXT,
    "status" TEXT NOT NULL,
    "errcode" TEXT,
    "sentAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotifyDelivery_appId_fkey" FOREIGN KEY ("appId") REFERENCES "NotifyApp" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotifyDelivery_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "NotifyChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NotifyMiniProgram_appId_key" ON "NotifyMiniProgram"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "NotifyTemplate_miniProgramId_key_key" ON "NotifyTemplate"("miniProgramId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "NotifyApp_key_key" ON "NotifyApp"("key");

-- CreateIndex
CREATE INDEX "NotifyApp_miniProgramId_idx" ON "NotifyApp"("miniProgramId");

-- CreateIndex
CREATE UNIQUE INDEX "NotifyApiKey_tokenHash_key" ON "NotifyApiKey"("tokenHash");

-- CreateIndex
CREATE INDEX "NotifyApiKey_appId_idx" ON "NotifyApiKey"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "NotifyChannel_bindCode_key" ON "NotifyChannel"("bindCode");

-- CreateIndex
CREATE INDEX "NotifyChannel_bindCode_idx" ON "NotifyChannel"("bindCode");

-- CreateIndex
CREATE UNIQUE INDEX "NotifyChannel_appId_key_key" ON "NotifyChannel"("appId", "key");

-- CreateIndex
CREATE INDEX "NotifySubscription_openId_idx" ON "NotifySubscription"("openId");

-- CreateIndex
CREATE UNIQUE INDEX "NotifySubscription_channelId_openId_key" ON "NotifySubscription"("channelId", "openId");

-- CreateIndex
CREATE INDEX "NotifySubscribeQuota_openId_idx" ON "NotifySubscribeQuota"("openId");

-- CreateIndex
CREATE UNIQUE INDEX "NotifySubscribeQuota_miniProgramId_openId_templateKey_key" ON "NotifySubscribeQuota"("miniProgramId", "openId", "templateKey");

-- CreateIndex
CREATE INDEX "NotifyDelivery_openId_createdAt_idx" ON "NotifyDelivery"("openId", "createdAt");

-- CreateIndex
CREATE INDEX "NotifyDelivery_channelId_createdAt_idx" ON "NotifyDelivery"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "NotifyDelivery_expiresAt_idx" ON "NotifyDelivery"("expiresAt");

-- CreateIndex
CREATE INDEX "NotifyDelivery_appId_dedupeKey_idx" ON "NotifyDelivery"("appId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "NotifyDelivery_appId_dedupeKey_openId_key" ON "NotifyDelivery"("appId", "dedupeKey", "openId");

