-- CreateTable
CREATE TABLE "FocusTraderCohort" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FocusTraderCohortMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cohortId" TEXT NOT NULL,
    "trackedWalletId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'COMPARISON',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FocusTraderCohortMember_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "FocusTraderCohort" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FocusTraderCohortMember_trackedWalletId_fkey" FOREIGN KEY ("trackedWalletId") REFERENCES "TrackedWallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletStrategyFingerprintRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "requestedWalletCount" INTEGER NOT NULL DEFAULT 0,
    "processedWalletCount" INTEGER NOT NULL DEFAULT 0,
    "fingerprintCount" INTEGER NOT NULL DEFAULT 0,
    "patternCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCycleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCycleCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "sanitizedErrorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WalletStrategyFingerprint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "trackedWalletId" TEXT NOT NULL,
    "reconstructionRunId" TEXT NOT NULL,
    "qualityMetricSetId" TEXT,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "eligibleCycleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCycleCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleBuyCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleSellCount" INTEGER NOT NULL DEFAULT 0,
    "medianBuysPerCycle" TEXT,
    "meanBuysPerCycle" TEXT,
    "p25BuysPerCycle" TEXT,
    "p75BuysPerCycle" TEXT,
    "singleBuyCycleCount" INTEGER NOT NULL DEFAULT 0,
    "twoBuyCycleCount" INTEGER NOT NULL DEFAULT 0,
    "multiBuyCycleCount" INTEGER NOT NULL DEFAULT 0,
    "medianFirstToSecondBuySeconds" TEXT,
    "medianLaterBuyGapSeconds" TEXT,
    "medianFirstBuySol" TEXT,
    "medianCycleCostSol" TEXT,
    "p75CycleCostSol" TEXT,
    "medianFirstBuySharePct" TEXT,
    "medianLargestBuySharePct" TEXT,
    "largestBuyFirstCycleCount" INTEGER NOT NULL DEFAULT 0,
    "increasingSizeCycleCount" INTEGER NOT NULL DEFAULT 0,
    "cyclesWithSellCount" INTEGER NOT NULL DEFAULT 0,
    "medianSellsPerCycle" TEXT,
    "singleSellCycleCount" INTEGER NOT NULL DEFAULT 0,
    "twoSellCycleCount" INTEGER NOT NULL DEFAULT 0,
    "multiSellCycleCount" INTEGER NOT NULL DEFAULT 0,
    "medianFirstBuyToFirstSellSeconds" TEXT,
    "medianLastBuyToFirstSellSeconds" TEXT,
    "medianFirstSellInventoryPct" TEXT,
    "medianLargestSellInventoryPct" TEXT,
    "medianRemainingAfterFirstSellPct" TEXT,
    "medianFirstSellToFinalSellSeconds" TEXT,
    "partialFirstExitCycleCount" INTEGER NOT NULL DEFAULT 0,
    "fullyClosedCycleCount" INTEGER NOT NULL DEFAULT 0,
    "openCycleCount" INTEGER NOT NULL DEFAULT 0,
    "transferAffectedCycleCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedSellCount" INTEGER NOT NULL DEFAULT 0,
    "unknownBasisCycleCount" INTEGER NOT NULL DEFAULT 0,
    "missingFeeCycleCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCoveragePct" TEXT,
    "feeCoveragePct" TEXT,
    "completeHistory" BOOLEAN NOT NULL DEFAULT false,
    "distinctTokenCount" INTEGER NOT NULL DEFAULT 0,
    "repeatedTokenCount" INTEGER NOT NULL DEFAULT 0,
    "repeatedTokenCycleCount" INTEGER NOT NULL DEFAULT 0,
    "maxCyclesPerToken" INTEGER NOT NULL DEFAULT 0,
    "medianSecondsBetweenTokenCycles" TEXT,
    "medianFeePerBuySol" TEXT,
    "medianFeePerSellSol" TEXT,
    "medianFeePerCycleSol" TEXT,
    "medianFeeBurdenPct" TEXT,
    "p75FeeBurdenPct" TEXT,
    "feeBurdenOver1PctCount" INTEGER NOT NULL DEFAULT 0,
    "feeBurdenOver2PctCount" INTEGER NOT NULL DEFAULT 0,
    "feeBurdenOver5PctCount" INTEGER NOT NULL DEFAULT 0,
    "feeBurdenOver10PctCount" INTEGER NOT NULL DEFAULT 0,
    "medianLegsPerCycle" TEXT,
    "observedMaxConcurrentPositions" INTEGER NOT NULL DEFAULT 0,
    "medianConcurrentPositions" TEXT,
    "descriptorCodes" TEXT NOT NULL DEFAULT '[]',
    "descriptorEvidenceJson" TEXT NOT NULL DEFAULT '[]',
    "warningCodes" TEXT NOT NULL DEFAULT '[]',
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletStrategyFingerprint_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WalletStrategyFingerprintRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WalletStrategyFingerprint_trackedWalletId_fkey" FOREIGN KEY ("trackedWalletId") REFERENCES "TrackedWallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletStrategyPatternMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprintId" TEXT NOT NULL,
    "patternType" TEXT NOT NULL,
    "patternValue" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "percentage" TEXT,
    "medianSizeSol" TEXT,
    "medianDurationSeconds" TEXT,
    "medianRawResultSol" TEXT,
    "confidence" TEXT NOT NULL,
    "warningCodes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletStrategyPatternMetric_fingerprintId_fkey" FOREIGN KEY ("fingerprintId") REFERENCES "WalletStrategyFingerprint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FocusTraderCohort_name_key" ON "FocusTraderCohort"("name");

-- CreateIndex
CREATE INDEX "FocusTraderCohort_name_idx" ON "FocusTraderCohort"("name");

-- CreateIndex
CREATE INDEX "FocusTraderCohort_createdAt_idx" ON "FocusTraderCohort"("createdAt");

-- CreateIndex
CREATE INDEX "FocusTraderCohortMember_cohortId_displayOrder_idx" ON "FocusTraderCohortMember"("cohortId", "displayOrder");

-- CreateIndex
CREATE INDEX "FocusTraderCohortMember_trackedWalletId_idx" ON "FocusTraderCohortMember"("trackedWalletId");

-- CreateIndex
CREATE INDEX "FocusTraderCohortMember_role_idx" ON "FocusTraderCohortMember"("role");

-- CreateIndex
CREATE UNIQUE INDEX "FocusTraderCohortMember_cohortId_trackedWalletId_key" ON "FocusTraderCohortMember"("cohortId", "trackedWalletId");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprintRun_status_idx" ON "WalletStrategyFingerprintRun"("status");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprintRun_startedAt_idx" ON "WalletStrategyFingerprintRun"("startedAt");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprintRun_calculationVersion_idx" ON "WalletStrategyFingerprintRun"("calculationVersion");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprint_trackedWalletId_idx" ON "WalletStrategyFingerprint"("trackedWalletId");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprint_runId_idx" ON "WalletStrategyFingerprint"("runId");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprint_reconstructionRunId_idx" ON "WalletStrategyFingerprint"("reconstructionRunId");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprint_qualityMetricSetId_idx" ON "WalletStrategyFingerprint"("qualityMetricSetId");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprint_status_idx" ON "WalletStrategyFingerprint"("status");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprint_confidence_idx" ON "WalletStrategyFingerprint"("confidence");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprint_calculationVersion_idx" ON "WalletStrategyFingerprint"("calculationVersion");

-- CreateIndex
CREATE INDEX "WalletStrategyFingerprint_calculatedAt_idx" ON "WalletStrategyFingerprint"("calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletStrategyFingerprint_runId_trackedWalletId_calculationVersion_key" ON "WalletStrategyFingerprint"("runId", "trackedWalletId", "calculationVersion");

-- CreateIndex
CREATE INDEX "WalletStrategyPatternMetric_fingerprintId_patternType_sortOrder_idx" ON "WalletStrategyPatternMetric"("fingerprintId", "patternType", "sortOrder");

-- CreateIndex
CREATE INDEX "WalletStrategyPatternMetric_patternType_idx" ON "WalletStrategyPatternMetric"("patternType");

-- CreateIndex
CREATE INDEX "WalletStrategyPatternMetric_confidence_idx" ON "WalletStrategyPatternMetric"("confidence");

-- CreateIndex
CREATE UNIQUE INDEX "WalletStrategyPatternMetric_fingerprintId_patternType_patternValue_key" ON "WalletStrategyPatternMetric"("fingerprintId", "patternType", "patternValue");
