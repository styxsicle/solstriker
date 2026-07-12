-- CreateTable
CREATE TABLE "WalletQualityAnalysisRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "requestedWalletCount" INTEGER NOT NULL DEFAULT 0,
    "processedWalletCount" INTEGER NOT NULL DEFAULT 0,
    "eligiblePositionCount" INTEGER NOT NULL DEFAULT 0,
    "excludedPositionCount" INTEGER NOT NULL DEFAULT 0,
    "metricSetCount" INTEGER NOT NULL DEFAULT 0,
    "categorySetCount" INTEGER NOT NULL DEFAULT 0,
    "timeWindowSetCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "sanitizedErrorSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WalletQualityMetricSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisRunId" TEXT NOT NULL,
    "reconstructionRunId" TEXT NOT NULL,
    "trackedWalletId" TEXT NOT NULL,
    "calculationVersion" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "sampleSizeTier" TEXT NOT NULL,
    "totalPositionCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleClosedCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleOpenCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCount" INTEGER NOT NULL DEFAULT 0,
    "highConfidenceCount" INTEGER NOT NULL DEFAULT 0,
    "lowerConfidenceCount" INTEGER NOT NULL DEFAULT 0,
    "positiveRawCount" INTEGER NOT NULL DEFAULT 0,
    "negativeRawCount" INTEGER NOT NULL DEFAULT 0,
    "flatRawCount" INTEGER NOT NULL DEFAULT 0,
    "positiveAllInCount" INTEGER NOT NULL DEFAULT 0,
    "negativeAllInCount" INTEGER NOT NULL DEFAULT 0,
    "rawPositiveRatePct" TEXT,
    "allInPositiveRatePct" TEXT,
    "medianRawPnlSol" TEXT,
    "meanRawPnlSol" TEXT,
    "p25RawPnlSol" TEXT,
    "p75RawPnlSol" TEXT,
    "minRawPnlSol" TEXT,
    "maxRawPnlSol" TEXT,
    "medianAllInPnlSol" TEXT,
    "meanAllInPnlSol" TEXT,
    "medianRawRoiPct" TEXT,
    "meanRawRoiPct" TEXT,
    "p25RawRoiPct" TEXT,
    "p75RawRoiPct" TEXT,
    "medianAllInRoiPct" TEXT,
    "meanAllInRoiPct" TEXT,
    "grossGainSol" TEXT,
    "grossLossSol" TEXT,
    "profitFactor" TEXT,
    "largestGainContributionPct" TEXT,
    "largestLossContributionPct" TEXT,
    "medianHoldingSeconds" TEXT,
    "meanHoldingSeconds" TEXT,
    "p25HoldingSeconds" TEXT,
    "p75HoldingSeconds" TEXT,
    "medianPositionSizeSol" TEXT,
    "meanPositionSizeSol" TEXT,
    "p25PositionSizeSol" TEXT,
    "p75PositionSizeSol" TEXT,
    "observedDistinctTokenCount" INTEGER NOT NULL DEFAULT 0,
    "transferAffectedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedSellCount" INTEGER NOT NULL DEFAULT 0,
    "completeHistory" BOOLEAN NOT NULL DEFAULT false,
    "eligibleCoveragePct" TEXT,
    "knownFeeCoveragePct" TEXT,
    "outcomeCoveragePct" TEXT,
    "complete1hOutcomePct" TEXT,
    "complete24hOutcomePct" TEXT,
    "consistencyJson" TEXT NOT NULL DEFAULT '{}',
    "holdingBucketsJson" TEXT NOT NULL DEFAULT '{}',
    "outcomeMetricsJson" TEXT NOT NULL DEFAULT '{}',
    "warningCodes" TEXT NOT NULL DEFAULT '[]',
    "calculatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletQualityMetricSet_analysisRunId_fkey" FOREIGN KEY ("analysisRunId") REFERENCES "WalletQualityAnalysisRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WalletQualityMetricSet_reconstructionRunId_fkey" FOREIGN KEY ("reconstructionRunId") REFERENCES "WalletPositionReconstructionRun" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WalletQualityMetricSet_trackedWalletId_fkey" FOREIGN KEY ("trackedWalletId") REFERENCES "TrackedWallet" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletCategoryMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metricSetId" TEXT NOT NULL,
    "categoryType" TEXT NOT NULL,
    "categoryValue" TEXT NOT NULL,
    "totalSampleCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleSampleCount" INTEGER NOT NULL DEFAULT 0,
    "excludedSampleCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" TEXT NOT NULL,
    "positiveRawCount" INTEGER NOT NULL DEFAULT 0,
    "negativeRawCount" INTEGER NOT NULL DEFAULT 0,
    "rawPositiveRatePct" TEXT,
    "medianRawPnlSol" TEXT,
    "medianRawRoiPct" TEXT,
    "medianAllInRoiPct" TEXT,
    "medianHoldingSeconds" TEXT,
    "medianPositionSizeSol" TEXT,
    "warningCodes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletCategoryMetric_metricSetId_fkey" FOREIGN KEY ("metricSetId") REFERENCES "WalletQualityMetricSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletTimeWindowMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metricSetId" TEXT NOT NULL,
    "windowType" TEXT NOT NULL,
    "windowStart" DATETIME,
    "windowEnd" DATETIME,
    "sampleCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleSampleCount" INTEGER NOT NULL DEFAULT 0,
    "confidence" TEXT NOT NULL,
    "positiveRawRatePct" TEXT,
    "medianRawPnlSol" TEXT,
    "medianRawRoiPct" TEXT,
    "medianAllInRoiPct" TEXT,
    "medianHoldingSeconds" TEXT,
    "medianPositionSizeSol" TEXT,
    "warningCodes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletTimeWindowMetric_metricSetId_fkey" FOREIGN KEY ("metricSetId") REFERENCES "WalletQualityMetricSet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WalletQualityAnalysisRun_status_idx" ON "WalletQualityAnalysisRun"("status");

-- CreateIndex
CREATE INDEX "WalletQualityAnalysisRun_startedAt_idx" ON "WalletQualityAnalysisRun"("startedAt");

-- CreateIndex
CREATE INDEX "WalletQualityAnalysisRun_calculationVersion_idx" ON "WalletQualityAnalysisRun"("calculationVersion");

-- CreateIndex
CREATE INDEX "WalletQualityMetricSet_trackedWalletId_idx" ON "WalletQualityMetricSet"("trackedWalletId");

-- CreateIndex
CREATE INDEX "WalletQualityMetricSet_analysisRunId_idx" ON "WalletQualityMetricSet"("analysisRunId");

-- CreateIndex
CREATE INDEX "WalletQualityMetricSet_reconstructionRunId_idx" ON "WalletQualityMetricSet"("reconstructionRunId");

-- CreateIndex
CREATE INDEX "WalletQualityMetricSet_sampleSizeTier_idx" ON "WalletQualityMetricSet"("sampleSizeTier");

-- CreateIndex
CREATE INDEX "WalletQualityMetricSet_status_idx" ON "WalletQualityMetricSet"("status");

-- CreateIndex
CREATE INDEX "WalletQualityMetricSet_calculationVersion_idx" ON "WalletQualityMetricSet"("calculationVersion");

-- CreateIndex
CREATE INDEX "WalletQualityMetricSet_calculatedAt_idx" ON "WalletQualityMetricSet"("calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WalletQualityMetricSet_analysisRunId_trackedWalletId_calculationVersion_key" ON "WalletQualityMetricSet"("analysisRunId", "trackedWalletId", "calculationVersion");

-- CreateIndex
CREATE INDEX "WalletCategoryMetric_categoryType_categoryValue_idx" ON "WalletCategoryMetric"("categoryType", "categoryValue");

-- CreateIndex
CREATE INDEX "WalletCategoryMetric_confidence_idx" ON "WalletCategoryMetric"("confidence");

-- CreateIndex
CREATE UNIQUE INDEX "WalletCategoryMetric_metricSetId_categoryType_categoryValue_key" ON "WalletCategoryMetric"("metricSetId", "categoryType", "categoryValue");

-- CreateIndex
CREATE INDEX "WalletTimeWindowMetric_windowType_idx" ON "WalletTimeWindowMetric"("windowType");

-- CreateIndex
CREATE INDEX "WalletTimeWindowMetric_windowStart_windowEnd_idx" ON "WalletTimeWindowMetric"("windowStart", "windowEnd");

-- CreateIndex
CREATE INDEX "WalletTimeWindowMetric_confidence_idx" ON "WalletTimeWindowMetric"("confidence");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTimeWindowMetric_metricSetId_windowType_key" ON "WalletTimeWindowMetric"("metricSetId", "windowType");
