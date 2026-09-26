-- CreateEnum
CREATE TYPE "BotStrategy" AS ENUM ('DCA', 'PRICE_TRIGGER');

-- CreateEnum
CREATE TYPE "BotStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "BotTriggerDirection" AS ENUM ('ABOVE', 'BELOW');

-- CreateTable
CREATE TABLE "TradingBot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" "BotStrategy" NOT NULL,
    "side" "OrderSide" NOT NULL,
    "quoteAmount" DECIMAL(36,18) NOT NULL,
    "intervalMinutes" INTEGER,
    "triggerPrice" DECIMAL(36,18),
    "triggerDirection" "BotTriggerDirection",
    "maxRuns" INTEGER,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "status" "BotStatus" NOT NULL DEFAULT 'ACTIVE',
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastError" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingBot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingBotRun" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "orderId" TEXT,
    "success" BOOLEAN NOT NULL,
    "price" DECIMAL(36,18),
    "quantity" DECIMAL(36,18),
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingBotRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TradingBot_userId_createdAt_idx" ON "TradingBot"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TradingBot_status_strategy_nextRunAt_idx" ON "TradingBot"("status", "strategy", "nextRunAt");

-- CreateIndex
CREATE INDEX "TradingBotRun_botId_createdAt_idx" ON "TradingBotRun"("botId", "createdAt");

-- AddForeignKey
ALTER TABLE "TradingBot" ADD CONSTRAINT "TradingBot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingBot" ADD CONSTRAINT "TradingBot_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingBotRun" ADD CONSTRAINT "TradingBotRun_botId_fkey" FOREIGN KEY ("botId") REFERENCES "TradingBot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
