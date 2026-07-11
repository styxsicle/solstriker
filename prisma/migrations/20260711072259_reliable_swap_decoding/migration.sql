-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WalletEvent" (
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
    "venue" TEXT,
    "confidence" TEXT,
    "explanation" TEXT,
    "swapInMint" TEXT,
    "swapInAmount" REAL,
    "swapOutMint" TEXT,
    "swapOutAmount" REAL,
    "walletSolChange" REAL,
    "networkFeeSol" REAL,
    "priorityFeeSol" REAL,
    "platformFeeSol" REAL,
    "tipSol" REAL,
    "rentSol" REAL,
    "unrelatedSolIn" REAL,
    "unrelatedSolOut" REAL,
    "unattributedSol" REAL,
    "decoderVersion" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "WalletEvent_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "TrackedWallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WalletEvent_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_WalletEvent" ("blockTime", "createdAt", "dedupeKey", "eventType", "id", "quoteAmount", "quoteMint", "signature", "slot", "source", "tokenAmount", "tokenId", "walletId") SELECT "blockTime", "createdAt", "dedupeKey", "eventType", "id", "quoteAmount", "quoteMint", "signature", "slot", "source", "tokenAmount", "tokenId", "walletId" FROM "WalletEvent";
DROP TABLE "WalletEvent";
ALTER TABLE "new_WalletEvent" RENAME TO "WalletEvent";
CREATE UNIQUE INDEX "WalletEvent_dedupeKey_key" ON "WalletEvent"("dedupeKey");
CREATE INDEX "WalletEvent_walletId_blockTime_idx" ON "WalletEvent"("walletId", "blockTime");
CREATE INDEX "WalletEvent_tokenId_idx" ON "WalletEvent"("tokenId");
CREATE INDEX "WalletEvent_eventType_idx" ON "WalletEvent"("eventType");
CREATE INDEX "WalletEvent_signature_idx" ON "WalletEvent"("signature");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
