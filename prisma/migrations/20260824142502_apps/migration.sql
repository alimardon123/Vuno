-- CreateTable
CREATE TABLE "AppInstall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installedBy" TEXT,
    CONSTRAINT "AppInstall_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AppInstall_orgId_idx" ON "AppInstall"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "AppInstall_orgId_key_key" ON "AppInstall"("orgId", "key");
