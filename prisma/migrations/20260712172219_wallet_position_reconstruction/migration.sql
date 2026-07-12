-- CreateTable
CREATE TABLE "WalletPositionReconstructionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "method" TEXT NOT NULL DEFAULT 'FIFO',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "requestedWalletCount" INTEGER NOT NULL DEFAULT 0,
    "processedWalletCount" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "includedEventCount" INTEGER NOT NULL DEFAULT 0,
    "excludedEventCount" INTEGER NOT NULL DEFAULT 0,
    "positionCount" INTEGER NOT NULL DEFAULT 0,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "profileCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "sanitizedErrorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WalletPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reconstructionRunId" TEXT NOT NULL,
    "trackedWalletId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "openedAt" DATETIME,
    "closedAt" DATETIME,
    "firstBuyEventId" TEXT,
    "lastEventAt" DATETIME,
    "quoteAsset" TEXT NOT NULL DEFAULT 'SOL',
    "totalBoughtTokenAmount" TEXT,
    "totalSoldTokenAmount" TEXT,
    "openTokenAmount" TEXT,
    "knownCostBasisSol" TEXT,
    "knownProceedsSol" TEXT,
    "allocatedKnownFeesSol" TEXT,
    "rawRealizedPnlSol" TEXT,
    "knownAllInRealizedPnlSol" TEXT,
    "rawRealizedRoiPct" TEXT,
    "knownAllInRealizedRoiPct" TEXT,
    "estimatedCurrentValueSol" TEXT,
    "estimatedCurrentValueUsd" TEXT,
    "estimatedUnrealizedPnlSol" TEXT,
    "estimatedUnrealizedRoiPct" TEXT,
    "valuationSnapshotId" TEXT,
    "valuationObservedAt" DATETIME,
    "valuationFreshness" TEXT,
    "valuationStatus" TEXT,
    "holdingDurationSeconds" INTEGER,
    "transferInAmount" TEXT,
    "transferOutAmount" TEXT,
    "unmatchedSellAmount" TEXT,
    "unknownBasisAmount" TEXT,
    "includedEventCount" INTEGER NOT NULL DEFAULT 0,
    "excludedEventCount" INTEGER NOT NULL DEFAULT 0,
    "includedEventIdsJson" TEXT NOT NULL DEFAULT '[]',
    "exclusionReasonsJson" TEXT NOT NULL DEFAULT '[]',
    "decoderVersionsJson" TEXT NOT NULL DEFAULT '[]',
    "warningCodes" TEXT NOT NULL DEFAULT '[]',
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletPosition_reconstructionRunId_fkey" FOREIGN KEY ("reconstructionRunId") REFERENCES "WalletPositionReconstructionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WalletPosition_trackedWalletId_fkey" FOREIGN KEY ("trackedWalletId") REFERENCES "TrackedWallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WalletPosition_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletTradeMatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT NOT NULL,
    "buyEventId" TEXT NOT NULL,
    "sellEventId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "matchedTokenAmount" TEXT NOT NULL,
    "allocatedBuyCostSol" TEXT,
    "allocatedBuyFeesSol" TEXT,
    "allocatedSellProceedsSol" TEXT,
    "allocatedSellFeesSol" TEXT,
    "rawRealizedPnlSol" TEXT,
    "knownAllInRealizedPnlSol" TEXT,
    "rawRealizedRoiPct" TEXT,
    "knownAllInRealizedRoiPct" TEXT,
    "holdingDurationSeconds" INTEGER,
    "confidence" TEXT NOT NULL,
    "warningCodes" TEXT NOT NULL DEFAULT '[]',
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletTradeMatch_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "WalletPosition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletBehaviorProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reconstructionRunId" TEXT NOT NULL,
    "trackedWalletId" TEXT NOT NULL,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "eligibleBuyCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleSellCount" INTEGER NOT NULL DEFAULT 0,
    "closedPositionCount" INTEGER NOT NULL DEFAULT 0,
    "openPositionCount" INTEGER NOT NULL DEFAULT 0,
    "partialPositionCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedSellCount" INTEGER NOT NULL DEFAULT 0,
    "transferAffectedPositionCount" INTEGER NOT NULL DEFAULT 0,
    "knownPositionSizeMedianSol" TEXT,
    "knownPositionSizeMeanSol" TEXT,
    "knownPositionSizeP25Sol" TEXT,
    "knownPositionSizeP75Sol" TEXT,
    "knownPositionSizeMinSol" TEXT,
    "knownPositionSizeMaxSol" TEXT,
    "closedHoldingMedianSeconds" TEXT,
    "closedHoldingMeanSeconds" TEXT,
    "observedMaxConcurrentPositions" INTEGER NOT NULL DEFAULT 0,
    "knownFeeBurdenMedianPct" TEXT,
    "completeHistory" BOOLEAN NOT NULL DEFAULT false,
    "warningCodes" TEXT NOT NULL DEFAULT '[]',
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletBehaviorProfile_reconstructionRunId_fkey" FOREIGN KEY ("reconstructionRunId") REFERENCES "WalletPositionReconstructionRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WalletBehaviorProfile_trackedWalletId_fkey" FOREIGN KEY ("trackedWalletId") REFERENCES "TrackedWallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WalletPositionReconstructionRun_startedAt_idx" ON "WalletPositionReconstructionRun"("startedAt");

-- CreateIndex
CREATE INDEX "WalletPositionReconstructionRun_status_idx" ON "WalletPositionReconstructionRun"("status");

-- CreateIndex
CREATE INDEX "WalletPosition_trackedWalletId_idx" ON "WalletPosition"("trackedWalletId");

-- CreateIndex
CREATE INDEX "WalletPosition_tokenId_idx" ON "WalletPosition"("tokenId");

-- CreateIndex
CREATE INDEX "WalletPosition_status_idx" ON "WalletPosition"("status");

-- CreateIndex
CREATE INDEX "WalletPosition_reconstructionRunId_idx" ON "WalletPosition"("reconstructionRunId");

-- CreateIndex
CREATE INDEX "WalletPosition_openedAt_idx" ON "WalletPosition"("openedAt");

-- CreateIndex
CREATE INDEX "WalletPosition_closedAt_idx" ON "WalletPosition"("closedAt");

-- CreateIndex
CREATE INDEX "WalletPosition_calculationVersion_idx" ON "WalletPosition"("calculationVersion");

-- CreateIndex
CREATE UNIQUE INDEX "WalletPosition_reconstructionRunId_trackedWalletId_tokenId_cycleNumber_key" ON "WalletPosition"("reconstructionRunId", "trackedWalletId", "tokenId", "cycleNumber");

-- CreateIndex
CREATE INDEX "WalletTradeMatch_buyEventId_idx" ON "WalletTradeMatch"("buyEventId");

-- CreateIndex
CREATE INDEX "WalletTradeMatch_sellEventId_idx" ON "WalletTradeMatch"("sellEventId");

-- CreateIndex
CREATE INDEX "WalletTradeMatch_calculationVersion_idx" ON "WalletTradeMatch"("calculationVersion");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTradeMatch_positionId_buyEventId_sellEventId_sequence_calculationVersion_key" ON "WalletTradeMatch"("positionId", "buyEventId", "sellEventId", "sequence", "calculationVersion");

-- CreateIndex
CREATE INDEX "WalletBehaviorProfile_trackedWalletId_idx" ON "WalletBehaviorProfile"("trackedWalletId");

-- CreateIndex
CREATE INDEX "WalletBehaviorProfile_reconstructionRunId_idx" ON "WalletBehaviorProfile"("reconstructionRunId");

-- CreateIndex
CREATE INDEX "WalletBehaviorProfile_status_idx" ON "WalletBehaviorProfile"("status");

-- CreateIndex
CREATE INDEX "WalletBehaviorProfile_calculationVersion_idx" ON "WalletBehaviorProfile"("calculationVersion");

-- CreateIndex
CREATE UNIQUE INDEX "WalletBehaviorProfile_reconstructionRunId_trackedWalletId_calculationVersion_key" ON "WalletBehaviorProfile"("reconstructionRunId", "trackedWalletId", "calculationVersion");
