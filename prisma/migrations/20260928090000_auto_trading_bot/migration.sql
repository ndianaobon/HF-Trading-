-- CreateEnum
CREATE TYPE "AutoBotStatus" AS ENUM ('RUNNING', 'PAUSED', 'STOPPED');

-- CreateEnum
CREATE TYPE "AutoBotSignalStatus" AS ENUM ('WATCHING', 'EXECUTED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AutoBotTradeStatus" AS ENUM ('PENDING', 'OPEN', 'CLOSED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AutoBotParticipantStatus" AS ENUM ('ACTIVE', 'PAUSED', 'STOPPED');

-- CreateTable
CREATE TABLE "AutoBotConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "status" "AutoBotStatus" NOT NULL DEFAULT 'STOPPED',
    "statusReason" TEXT,
    "statusChangedAt" TIMESTAMP(3),
    "statusChangedBy" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "health" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoBotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoBotAnalysis" (
    "symbol" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoBotAnalysis_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "AutoBotSignal" (
    "id" TEXT NOT NULL,
    "setupKey" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "status" "AutoBotSignalStatus" NOT NULL DEFAULT 'WATCHING',
    "strategy" TEXT NOT NULL DEFAULT 'SMC_ICT',
    "timeframes" JSONB NOT NULL,
    "htfBias" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "zoneLow" DECIMAL(36,18),
    "zoneHigh" DECIMAL(36,18),
    "entryPrice" DECIMAL(36,18),
    "stopLoss" DECIMAL(36,18),
    "takeProfit" DECIMAL(36,18),
    "riskReward" DECIMAL(18,8),
    "reason" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoBotSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoBotParticipant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AutoBotParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "enabledBy" TEXT NOT NULL DEFAULT 'USER',
    "startEquity" DECIMAL(36,18) NOT NULL,
    "statusReason" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoBotParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoBotTrade" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "status" "AutoBotTradeStatus" NOT NULL DEFAULT 'PENDING',
    "riskPct" DECIMAL(10,4) NOT NULL,
    "riskAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "notional" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "quantity" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "stopLoss" DECIMAL(36,18) NOT NULL,
    "takeProfit" DECIMAL(36,18) NOT NULL,
    "entryOrderId" TEXT,
    "exitOrderId" TEXT,
    "entryPrice" DECIMAL(36,18),
    "exitPrice" DECIMAL(36,18),
    "entryValue" DECIMAL(36,18),
    "exitValue" DECIMAL(36,18),
    "fees" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "grossPnl" DECIMAL(36,18),
    "netPnl" DECIMAL(36,18),
    "heldAmount" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "closeReason" TEXT,
    "failReason" TEXT,
    "lastError" TEXT,
    "closingAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoBotTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutoBotSignal_setupKey_key" ON "AutoBotSignal"("setupKey");

-- CreateIndex
CREATE INDEX "AutoBotSignal_status_createdAt_idx" ON "AutoBotSignal"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AutoBotSignal_symbol_createdAt_idx" ON "AutoBotSignal"("symbol", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutoBotParticipant_userId_key" ON "AutoBotParticipant"("userId");

-- CreateIndex
CREATE INDEX "AutoBotParticipant_status_idx" ON "AutoBotParticipant"("status");

-- CreateIndex
CREATE INDEX "AutoBotTrade_userId_status_idx" ON "AutoBotTrade"("userId", "status");

-- CreateIndex
CREATE INDEX "AutoBotTrade_status_idx" ON "AutoBotTrade"("status");

-- CreateIndex
CREATE INDEX "AutoBotTrade_createdAt_idx" ON "AutoBotTrade"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutoBotTrade_signalId_userId_key" ON "AutoBotTrade"("signalId", "userId");

-- AddForeignKey
ALTER TABLE "AutoBotSignal" ADD CONSTRAINT "AutoBotSignal_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoBotParticipant" ADD CONSTRAINT "AutoBotParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoBotTrade" ADD CONSTRAINT "AutoBotTrade_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "AutoBotSignal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoBotTrade" ADD CONSTRAINT "AutoBotTrade_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "AutoBotParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoBotTrade" ADD CONSTRAINT "AutoBotTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoBotTrade" ADD CONSTRAINT "AutoBotTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

