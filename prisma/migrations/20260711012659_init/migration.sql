-- CreateTable
CREATE TABLE "TrackedWallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "address" TEXT NOT NULL,
    "label" TEXT,
    "group" TEXT,
    "groupsJson" TEXT,
    "emoji" TEXT,
    "notes" TEXT,
    "metaJson" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mintAddress" TEXT NOT NULL,
    "name" TEXT,
    "symbol" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "source" TEXT NOT NULL DEFAULT 'dev-seed',
    "discoveredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackedWallet_address_key" ON "TrackedWallet"("address");

-- CreateIndex
CREATE INDEX "TrackedWallet_group_idx" ON "TrackedWallet"("group");

-- CreateIndex
CREATE INDEX "TrackedWallet_enabled_idx" ON "TrackedWallet"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Token_mintAddress_key" ON "Token"("mintAddress");

-- CreateIndex
CREATE INDEX "Token_stage_idx" ON "Token"("stage");
