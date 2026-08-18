-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Column" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "board" TEXT NOT NULL DEFAULT 'analysis',
    "order" INTEGER NOT NULL,
    "projectId" TEXT NOT NULL,
    CONSTRAINT "Column_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Column" ("id", "name", "order", "projectId") SELECT "id", "name", "order", "projectId" FROM "Column";
DROP TABLE "Column";
ALTER TABLE "new_Column" RENAME TO "Column";
CREATE INDEX "Column_projectId_idx" ON "Column"("projectId");
CREATE INDEX "Column_projectId_board_idx" ON "Column"("projectId", "board");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
