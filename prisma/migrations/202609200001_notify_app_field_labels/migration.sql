-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotifyApp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "miniProgramId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fieldLabels" TEXT NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotifyApp_miniProgramId_fkey" FOREIGN KEY ("miniProgramId") REFERENCES "NotifyMiniProgram" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NotifyApp" ("createdAt", "id", "isActive", "key", "miniProgramId", "name", "updatedAt") SELECT "createdAt", "id", "isActive", "key", "miniProgramId", "name", "updatedAt" FROM "NotifyApp";
DROP TABLE "NotifyApp";
ALTER TABLE "new_NotifyApp" RENAME TO "NotifyApp";
CREATE UNIQUE INDEX "NotifyApp_key_key" ON "NotifyApp"("key");
CREATE INDEX "NotifyApp_miniProgramId_idx" ON "NotifyApp"("miniProgramId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
