-- CreateTable
CREATE TABLE "Plugin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "author" TEXT,
    "source" TEXT NOT NULL DEFAULT 'catalogue',
    "manifest" TEXT NOT NULL,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Plugin_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Connection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'http',
    "url" TEXT NOT NULL,
    "authEnvVar" TEXT,
    "toolsCache" TEXT,
    "checkedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "pluginId" TEXT,
    CONSTRAINT "Connection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Connection_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "Plugin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Connection" ("authEnvVar", "checkedAt", "createdAt", "id", "key", "lastError", "name", "orgId", "summary", "tenantId", "toolsCache", "transport", "updatedAt", "url") SELECT "authEnvVar", "checkedAt", "createdAt", "id", "key", "lastError", "name", "orgId", "summary", "tenantId", "toolsCache", "transport", "updatedAt", "url" FROM "Connection";
DROP TABLE "Connection";
ALTER TABLE "new_Connection" RENAME TO "Connection";
CREATE INDEX "Connection_orgId_idx" ON "Connection"("orgId");
CREATE INDEX "Connection_pluginId_idx" ON "Connection"("pluginId");
CREATE UNIQUE INDEX "Connection_orgId_key_key" ON "Connection"("orgId", "key");
CREATE TABLE "new_Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'local',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "pluginId" TEXT,
    CONSTRAINT "Skill_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Skill_pluginId_fkey" FOREIGN KEY ("pluginId") REFERENCES "Plugin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Skill" ("content", "createdAt", "id", "key", "name", "orgId", "source", "summary", "tenantId", "updatedAt", "version") SELECT "content", "createdAt", "id", "key", "name", "orgId", "source", "summary", "tenantId", "updatedAt", "version" FROM "Skill";
DROP TABLE "Skill";
ALTER TABLE "new_Skill" RENAME TO "Skill";
CREATE INDEX "Skill_orgId_idx" ON "Skill"("orgId");
CREATE INDEX "Skill_pluginId_idx" ON "Skill"("pluginId");
CREATE UNIQUE INDEX "Skill_orgId_key_key" ON "Skill"("orgId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Plugin_orgId_idx" ON "Plugin"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Plugin_orgId_key_key" ON "Plugin"("orgId", "key");
