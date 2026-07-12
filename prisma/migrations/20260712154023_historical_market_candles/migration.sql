-- CreateTable
CREATE TABLE "HistoricalMarketBackfillRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "requestedTokenCount" INTEGER NOT NULL DEFAULT 0,
    "processedTokenCount" INTEGER NOT NULL DEFAULT 0,
    "requestedInterval" TEXT NOT NULL,
    "requestedStart" DATETIME NOT NULL,
    "requestedEnd" DATETIME NOT NULL,
    "candlesInserted" INTEGER NOT NULL DEFAULT 0,
    "candlesUpdated" INTEGER NOT NULL DEFAULT 0,
    "duplicatesPrevented" INTEGER NOT NULL DEFAULT 0,
    "gapCount" INTEGER NOT NULL DEFAULT 0,
    "completeCount" INTEGER NOT NULL DEFAULT 0,
    "partialCount" INTEGER NOT NULL DEFAULT 0,
    "notFoundCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "sanitizedErrorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TokenMarketCandle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenId" TEXT NOT NULL,
    "pairAddress" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "openTime" DATETIME NOT NULL,
    "closeTime" DATETIME NOT NULL,
    "open" TEXT NOT NULL,
    "high" TEXT NOT NULL,
    "low" TEXT NOT NULL,
    "close" TEXT NOT NULL,
    "volumeUsd" TEXT,
    "source" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "backfillRunId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TokenMarketCandle_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TokenMarketCandle_backfillRunId_fkey" FOREIGN KEY ("backfillRunId") REFERENCES "HistoricalMarketBackfillRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletEntryOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletEventId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "pairAddress" TEXT,
    "entryTime" DATETIME NOT NULL,
    "entryPriceUsd" TEXT,
    "entryPriceMethod" TEXT NOT NULL,
    "entryCandleTime" DATETIME,
    "entryDelaySeconds" INTEGER,
    "price1mUsd" TEXT,
    "price5mUsd" TEXT,
    "price15mUsd" TEXT,
    "price30mUsd" TEXT,
    "price1hUsd" TEXT,
    "price4hUsd" TEXT,
    "price24hUsd" TEXT,
    "return1mPct" TEXT,
    "return5mPct" TEXT,
    "return15mPct" TEXT,
    "return30mPct" TEXT,
    "return1hPct" TEXT,
    "return4hPct" TEXT,
    "return24hPct" TEXT,
    "maxPrice1hUsd" TEXT,
    "minPrice1hUsd" TEXT,
    "maxReturn1hPct" TEXT,
    "maxDrawdown1hPct" TEXT,
    "timeToMax1hSeconds" INTEGER,
    "maxPrice24hUsd" TEXT,
    "minPrice24hUsd" TEXT,
    "maxReturn24hPct" TEXT,
    "maxDrawdown24hPct" TEXT,
    "timeToMax24hSeconds" INTEGER,
    "status" TEXT NOT NULL,
    "confidence" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "coverageStart" DATETIME,
    "coverageEnd" DATETIME,
    "missingWindowCount" INTEGER NOT NULL DEFAULT 0,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletEntryOutcome_walletEventId_fkey" FOREIGN KEY ("walletEventId") REFERENCES "WalletEvent" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WalletEntryOutcome_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HistoricalMarketBackfillRun_startedAt_idx" ON "HistoricalMarketBackfillRun"("startedAt");

-- CreateIndex
CREATE INDEX "TokenMarketCandle_tokenId_openTime_idx" ON "TokenMarketCandle"("tokenId", "openTime");

-- CreateIndex
CREATE INDEX "TokenMarketCandle_pairAddress_openTime_idx" ON "TokenMarketCandle"("pairAddress", "openTime");

-- CreateIndex
CREATE INDEX "TokenMarketCandle_interval_openTime_idx" ON "TokenMarketCandle"("interval", "openTime");

-- CreateIndex
CREATE INDEX "TokenMarketCandle_backfillRunId_idx" ON "TokenMarketCandle"("backfillRunId");

-- CreateIndex
CREATE INDEX "TokenMarketCandle_source_idx" ON "TokenMarketCandle"("source");

-- CreateIndex
CREATE INDEX "TokenMarketCandle_openTime_idx" ON "TokenMarketCandle"("openTime");

-- CreateIndex
CREATE UNIQUE INDEX "TokenMarketCandle_tokenId_pairAddress_interval_openTime_source_key" ON "TokenMarketCandle"("tokenId", "pairAddress", "interval", "openTime", "source");

-- CreateIndex
CREATE INDEX "WalletEntryOutcome_tokenId_idx" ON "WalletEntryOutcome"("tokenId");

-- CreateIndex
CREATE INDEX "WalletEntryOutcome_status_idx" ON "WalletEntryOutcome"("status");

-- CreateIndex
CREATE INDEX "WalletEntryOutcome_calculatedAt_idx" ON "WalletEntryOutcome"("calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletEntryOutcome_walletEventId_calculationVersion_key" ON "WalletEntryOutcome"("walletEventId", "calculationVersion");
