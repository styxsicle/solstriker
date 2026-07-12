-- CreateTable
CREATE TABLE "TokenMarketRefreshRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "requestedCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "completeCount" INTEGER NOT NULL DEFAULT 0,
    "partialCount" INTEGER NOT NULL DEFAULT 0,
    "notFoundCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotCount" INTEGER NOT NULL DEFAULT 0,
    "sanitizedErrorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TokenMarketSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenId" TEXT NOT NULL,
    "refreshRunId" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceUsd" TEXT,
    "priceSol" TEXT,
    "marketCapUsd" TEXT,
    "fdvUsd" TEXT,
    "liquidityUsd" TEXT,
    "volume5mUsd" TEXT,
    "volume1hUsd" TEXT,
    "volume6hUsd" TEXT,
    "volume24hUsd" TEXT,
    "buys5m" INTEGER,
    "sells5m" INTEGER,
    "buys1h" INTEGER,
    "sells1h" INTEGER,
    "buys6h" INTEGER,
    "sells6h" INTEGER,
    "buys24h" INTEGER,
    "sells24h" INTEGER,
    "priceChange5mPct" TEXT,
    "priceChange1hPct" TEXT,
    "priceChange6hPct" TEXT,
    "priceChange24hPct" TEXT,
    "pairAddress" TEXT,
    "dex" TEXT,
    "baseMint" TEXT,
    "quoteMint" TEXT,
    "tokenName" TEXT,
    "tokenSymbol" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "selectionReason" TEXT,
    "sanitizedErrorCode" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TokenMarketSnapshot_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TokenMarketSnapshot_refreshRunId_fkey" FOREIGN KEY ("refreshRunId") REFERENCES "TokenMarketRefreshRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "TokenMarketRefreshRun_startedAt_idx" ON "TokenMarketRefreshRun"("startedAt");

-- CreateIndex
CREATE INDEX "TokenMarketSnapshot_tokenId_observedAt_idx" ON "TokenMarketSnapshot"("tokenId", "observedAt");

-- CreateIndex
CREATE INDEX "TokenMarketSnapshot_tokenId_fetchedAt_idx" ON "TokenMarketSnapshot"("tokenId", "fetchedAt");

-- CreateIndex
CREATE INDEX "TokenMarketSnapshot_refreshRunId_idx" ON "TokenMarketSnapshot"("refreshRunId");

-- CreateIndex
CREATE INDEX "TokenMarketSnapshot_source_idx" ON "TokenMarketSnapshot"("source");

-- CreateIndex
CREATE INDEX "TokenMarketSnapshot_status_idx" ON "TokenMarketSnapshot"("status");

-- CreateIndex
CREATE INDEX "TokenMarketSnapshot_observedAt_idx" ON "TokenMarketSnapshot"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenMarketSnapshot_refreshRunId_tokenId_key" ON "TokenMarketSnapshot"("refreshRunId", "tokenId");
