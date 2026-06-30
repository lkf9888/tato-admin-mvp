ALTER TABLE "Order" ADD COLUMN "ownerLedgerSyncedAt" DATETIME;

UPDATE "Order"
SET "ownerLedgerSyncedAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "ownerLedgerSyncedAt" IS NULL
  AND "isArchived" = false
  AND "status" <> 'cancelled'
  AND EXISTS (
    SELECT 1
    FROM "Vehicle"
    WHERE "Vehicle"."id" = "Order"."vehicleId"
      AND "Vehicle"."ownerId" IS NOT NULL
  );

CREATE INDEX "Order_ownerLedgerSyncedAt_idx" ON "Order"("ownerLedgerSyncedAt");
