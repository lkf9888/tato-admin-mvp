CREATE TABLE "DirectBookingDocument" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "orderId" TEXT,
    "checkoutSessionId" TEXT,
    "draftId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "filename" TEXT,
    "contentType" TEXT,
    "size" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DirectBookingDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DirectBookingDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DirectBookingDocument_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "DirectBookingDocument_workspaceId_idx" ON "DirectBookingDocument"("workspaceId");
CREATE INDEX "DirectBookingDocument_vehicleId_idx" ON "DirectBookingDocument"("vehicleId");
CREATE INDEX "DirectBookingDocument_orderId_idx" ON "DirectBookingDocument"("orderId");
CREATE INDEX "DirectBookingDocument_checkoutSessionId_idx" ON "DirectBookingDocument"("checkoutSessionId");
CREATE INDEX "DirectBookingDocument_draftId_idx" ON "DirectBookingDocument"("draftId");
