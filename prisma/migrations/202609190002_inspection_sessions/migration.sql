-- CreateTable
CREATE TABLE "InspectionSession" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientSessionId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "orderId" TEXT,
    "vehicleLabel" TEXT NOT NULL,
    "staffId" TEXT,
    "staffLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "deviceModel" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "timeZone" TEXT NOT NULL,
    "expectedSlotIds" JSONB NOT NULL,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InspectionSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InspectionSession_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InspectionSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InspectionSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InspectionShot" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "accepted" BOOLEAN NOT NULL DEFAULT true,
    "pathname" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "byteCount" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "capturedAt" DATETIME,
    "localCaptureTime" TEXT,
    "utcOffset" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "cameraMake" TEXT,
    "cameraModel" TEXT,
    "evidenceGaps" JSONB NOT NULL,
    "clockSkewSeconds" INTEGER,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportedSharpness" REAL,
    "reportedIssues" JSONB NOT NULL,
    "acceptedDespite" JSONB NOT NULL,
    "stationVerified" BOOLEAN,
    "metadataPath" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InspectionShot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "InspectionSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InspectionShot_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "InspectionSession_clientSessionId_key" ON "InspectionSession"("clientSessionId");

-- CreateIndex
CREATE INDEX "InspectionSession_workspaceId_startedAt_idx" ON "InspectionSession"("workspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "InspectionSession_vehicleId_startedAt_idx" ON "InspectionSession"("vehicleId", "startedAt");

-- CreateIndex
CREATE INDEX "InspectionSession_orderId_idx" ON "InspectionSession"("orderId");

-- CreateIndex
CREATE INDEX "InspectionSession_completedAt_idx" ON "InspectionSession"("completedAt");

-- CreateIndex
CREATE INDEX "InspectionShot_workspaceId_idx" ON "InspectionShot"("workspaceId");

-- CreateIndex
CREATE INDEX "InspectionShot_sessionId_accepted_idx" ON "InspectionShot"("sessionId", "accepted");

-- CreateIndex
CREATE INDEX "InspectionShot_sha256_idx" ON "InspectionShot"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "InspectionShot_sessionId_slotId_attempt_key" ON "InspectionShot"("sessionId", "slotId", "attempt");
