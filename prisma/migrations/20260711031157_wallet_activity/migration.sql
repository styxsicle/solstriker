-- CreateTable
CREATE TABLE "WalletEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "tokenId" TEXT,
    "signature" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "tokenAmount" REAL,
    "quoteMint" TEXT,
    "quoteAmount" REAL,
    "source" TEXT,
    "slot" INTEGER,
    "blockTime" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletEvent_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TrackedWallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WalletEvent_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletSyncState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "walletId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "backfillComplete" BOOLEAN NOT NULL DEFAULT false,
    "oldestSignature" TEXT,
    "newestSignature" TEXT,
    "lastSyncAt" DATETIME,
    "lastError" TEXT,
    "totalTransactions" INTEGER NOT NULL DEFAULT 0,
    "totalEvents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WalletSyncState_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TrackedWallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WalletEvent_dedupeKey_key" ON "WalletEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "WalletEvent_walletId_blockTime_idx" ON "WalletEvent"("walletId", "blockTime");

-- CreateIndex
CREATE INDEX "WalletEvent_tokenId_idx" ON "WalletEvent"("tokenId");

-- CreateIndex
CREATE INDEX "WalletEvent_eventType_idx" ON "WalletEvent"("eventType");

-- CreateIndex
CREATE INDEX "WalletEvent_signature_idx" ON "WalletEvent"("signature");

-- CreateIndex
CREATE UNIQUE INDEX "WalletSyncState_walletId_key" ON "WalletSyncState"("walletId");
