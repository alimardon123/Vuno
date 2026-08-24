-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AgentProfile" (
    "memberId" TEXT NOT NULL PRIMARY KEY,
    "role" TEXT NOT NULL,
    "modelName" TEXT NOT NULL DEFAULT 'claude-opus-5',
    "harnessName" TEXT NOT NULL DEFAULT 'anthropic',
    "tools" TEXT NOT NULL DEFAULT '[]',
    "permissions" TEXT NOT NULL DEFAULT '[]',
    "ownerMemberId" TEXT,
    "packageId" TEXT,
    "version" TEXT,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" DATETIME,
    "metadata" TEXT,
    CONSTRAINT "AgentProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentProfile_ownerMemberId_fkey" FOREIGN KEY ("ownerMemberId") REFERENCES "Member" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AgentProfile" ("harnessName", "installedAt", "memberId", "metadata", "modelName", "ownerMemberId", "packageId", "permissions", "retiredAt", "role", "tools", "version") SELECT "harnessName", "installedAt", "memberId", "metadata", "modelName", "ownerMemberId", "packageId", "permissions", "retiredAt", "role", "tools", "version" FROM "AgentProfile";
DROP TABLE "AgentProfile";
ALTER TABLE "new_AgentProfile" RENAME TO "AgentProfile";
CREATE INDEX "AgentProfile_role_idx" ON "AgentProfile"("role");
CREATE INDEX "AgentProfile_ownerMemberId_idx" ON "AgentProfile"("ownerMemberId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
