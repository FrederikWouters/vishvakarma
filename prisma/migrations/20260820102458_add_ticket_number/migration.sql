/*
  Warnings:

  - Added the required column `number` to the `Ticket` table without a default value. This is not possible if the table is not empty.
  - Added the required column `projectId` to the `Ticket` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Ticket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "columnId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Ticket_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "Column" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Backfill projectId from each ticket's column, and number as a per-project
-- sequence ordered by creation time (stable via rowid tie-break).
INSERT INTO "new_Ticket" ("id", "title", "description", "order", "number", "columnId", "projectId", "createdAt")
SELECT
    t."id",
    t."title",
    t."description",
    t."order",
    ROW_NUMBER() OVER (PARTITION BY c."projectId" ORDER BY t."createdAt" ASC, t."rowid" ASC) AS "number",
    t."columnId",
    c."projectId",
    t."createdAt"
FROM "Ticket" t
JOIN "Column" c ON c."id" = t."columnId";
DROP TABLE "Ticket";
ALTER TABLE "new_Ticket" RENAME TO "Ticket";
CREATE INDEX "Ticket_columnId_idx" ON "Ticket"("columnId");
CREATE UNIQUE INDEX "Ticket_projectId_number_key" ON "Ticket"("projectId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
