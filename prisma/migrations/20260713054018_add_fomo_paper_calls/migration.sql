-- CreateTable
CREATE TABLE "PaperCall" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "conviction" TEXT NOT NULL,
    "slowCookState" TEXT NOT NULL,
    "slowCookConfidence" TEXT NOT NULL,
    "slowCookMethodologyVersion" TEXT NOT NULL,
    "fomoMethodologyVersion" TEXT NOT NULL,
    "analyzedAt" DATETIME NOT NULL,
    "latestEvidenceAt" DATETIME,
    "tokenId" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "tokenName" TEXT,
    "tokenSymbol" TEXT,
    "cohortKey" TEXT NOT NULL,
    "walletIdsJson" TEXT NOT NULL,
    "walletAddressesJson" TEXT NOT NULL,
    "walletLabelsJson" TEXT NOT NULL,
    "styleSummariesJson" TEXT,
    "reasonsJson" TEXT NOT NULL,
    "invalidationJson" TEXT NOT NULL,
    "evidenceJson" TEXT NOT NULL,
    "dataQualityJson" TEXT NOT NULL,
    "settingsJson" TEXT NOT NULL,
    "entrySnapshotId" TEXT,
    "entryObservedAt" DATETIME,
    "entryPriceUsd" TEXT,
    "marketCapUsd" TEXT,
    "liquidityUsd" TEXT,
    "volume24hUsd" TEXT,
    "snapshotFreshness" TEXT,
    "simulatedAmountUsd" TEXT,
    "feeRatePct" TEXT,
    "entrySlippagePct" TEXT,
    "exitSlippagePct" TEXT,
    "priced" BOOLEAN NOT NULL DEFAULT false,
    "unpricedReason" TEXT,
    "warningCodes" TEXT NOT NULL DEFAULT '[]',
    "paperPositionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaperCall_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaperCall_paperPositionId_fkey" FOREIGN KEY ("paperPositionId") REFERENCES "PaperPosition" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenId" TEXT NOT NULL,
    "tokenMint" TEXT NOT NULL,
    "tokenName" TEXT,
    "tokenSymbol" TEXT,
    "cohortKey" TEXT NOT NULL,
    "walletIdsJson" TEXT NOT NULL,
    "methodologyVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "notionalUsd" TEXT NOT NULL,
    "feeRatePct" TEXT NOT NULL,
    "entrySlippagePct" TEXT NOT NULL,
    "exitSlippagePct" TEXT NOT NULL,
    "entrySnapshotId" TEXT NOT NULL,
    "entryObservedAt" DATETIME NOT NULL,
    "entryPriceUsd" TEXT NOT NULL,
    "effectiveEntryPriceUsd" TEXT NOT NULL,
    "entryFeeUsd" TEXT NOT NULL,
    "tokenQuantity" TEXT NOT NULL,
    "entryWarningCodes" TEXT NOT NULL DEFAULT '[]',
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "exitSnapshotId" TEXT,
    "exitObservedAt" DATETIME,
    "exitPriceUsd" TEXT,
    "grossExitValueUsd" TEXT,
    "exitFeeUsd" TEXT,
    "netExitValueUsd" TEXT,
    "realizedPlUsd" TEXT,
    "realizedReturnPct" TEXT,
    "latestValueUsd" TEXT,
    "unrealizedPlUsd" TEXT,
    "unrealizedReturnPct" TEXT,
    "latestValuationAt" DATETIME,
    "exitSignalPendingReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaperPosition_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaperPositionValuation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "positionId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "observedAt" DATETIME NOT NULL,
    "priceUsd" TEXT NOT NULL,
    "grossValueUsd" TEXT NOT NULL,
    "netValueUsd" TEXT NOT NULL,
    "unrealizedPlUsd" TEXT NOT NULL,
    "unrealizedReturnPct" TEXT NOT NULL,
    "freshness" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaperPositionValuation_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "PaperPosition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PaperCall_dedupeKey_key" ON "PaperCall"("dedupeKey");

-- CreateIndex
CREATE INDEX "PaperCall_tokenId_idx" ON "PaperCall"("tokenId");

-- CreateIndex
CREATE INDEX "PaperCall_cohortKey_idx" ON "PaperCall"("cohortKey");

-- CreateIndex
CREATE INDEX "PaperCall_action_idx" ON "PaperCall"("action");

-- CreateIndex
CREATE INDEX "PaperCall_createdAt_idx" ON "PaperCall"("createdAt");

-- CreateIndex
CREATE INDEX "PaperPosition_status_idx" ON "PaperPosition"("status");

-- CreateIndex
CREATE INDEX "PaperPosition_tokenId_cohortKey_methodologyVersion_idx" ON "PaperPosition"("tokenId", "cohortKey", "methodologyVersion");

-- CreateIndex
CREATE INDEX "PaperPosition_openedAt_idx" ON "PaperPosition"("openedAt");

-- CreateIndex
CREATE INDEX "PaperPositionValuation_positionId_observedAt_idx" ON "PaperPositionValuation"("positionId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaperPositionValuation_positionId_snapshotId_key" ON "PaperPositionValuation"("positionId", "snapshotId");
