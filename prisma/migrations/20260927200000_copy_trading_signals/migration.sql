-- CreateEnum
CREATE TYPE "LeadTraderStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SignalStatus" AS ENUM ('CREATED', 'ACTIVE', 'EXECUTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CopyTradeStatus" AS ENUM ('PENDING', 'OPEN', 'CLOSED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "CopyStatus" ADD VALUE 'SUSPENDED';

-- DropIndex
DROP INDEX "CopyTrader_isActive_riskLevel_idx";

-- Copy relationships: funds allocated under the previous model were debited from the
-- wallet; record them as escrow so they are returned when copying stops.
ALTER TABLE "CopySubscription" ADD COLUMN "amountPerTrade" DECIMAL(36,18),
ADD COLUMN     "escrowed" DECIMAL(36,18) NOT NULL DEFAULT 0;
UPDATE "CopySubscription" SET "amountPerTrade" = ROUND("allocation" / 10, 8), "escrowed" = CASE WHEN "status" <> 'STOPPED' THEN "allocation" ELSE 0 END;
ALTER TABLE "CopySubscription" ALTER COLUMN "amountPerTrade" SET NOT NULL, DROP COLUMN "maxAllocation";

-- Lead traders: the publish flag becomes a status; stored (unverified) performance figures
-- are dropped. Performance is now calculated from signals and copy trades.
ALTER TABLE "CopyTrader" ADD COLUMN "status" "LeadTraderStatus" NOT NULL DEFAULT 'INACTIVE';
UPDATE "CopyTrader" SET "status" = CASE WHEN "isActive" THEN 'ACTIVE'::"LeadTraderStatus" ELSE 'INACTIVE'::"LeadTraderStatus" END;

-- AlterTable
ALTER TABLE "CopyTrader" DROP COLUMN "aum",
DROP COLUMN "followers",
DROP COLUMN "isActive",
DROP COLUMN "isDemo",
DROP COLUMN "maxDrawdownPct",
DROP COLUMN "performanceSeries",
DROP COLUMN "profitSharePct",
DROP COLUMN "recentTrades",
DROP COLUMN "returns",
DROP COLUMN "tradesPerWeek",
DROP COLUMN "winRatePct",
ADD COLUMN     "avatarKey" TEXT,
ADD COLUMN     "copyEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "maxAllocation" DECIMAL(36,18);

-- CreateTable
CREATE TABLE "CopySignal" (
    "id" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "entryPrice" DECIMAL(36,18),
    "takeProfit" DECIMAL(36,18),
    "stopLoss" DECIMAL(36,18),
    "sizeMultiplier" DECIMAL(10,4) NOT NULL DEFAULT 1,
    "note" TEXT,
    "status" "SignalStatus" NOT NULL DEFAULT 'CREATED',
    "executedPrice" DECIMAL(36,18),
    "closePrice" DECIMAL(36,18),
    "closeReason" TEXT,
    "resultPct" DECIMAL(18,8),
    "createdById" TEXT,
    "activatedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopySignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CopyTrade" (
    "id" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "traderId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "status" "CopyTradeStatus" NOT NULL DEFAULT 'PENDING',
    "notional" DECIMAL(36,18) NOT NULL,
    "quantity" DECIMAL(36,18) NOT NULL DEFAULT 0,
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
    "failReason" TEXT,
    "lastError" TEXT,
    "closingAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CopyTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CopySignal_traderId_status_idx" ON "CopySignal"("traderId", "status");

-- CreateIndex
CREATE INDEX "CopySignal_status_idx" ON "CopySignal"("status");

-- CreateIndex
CREATE INDEX "CopyTrade_userId_status_idx" ON "CopyTrade"("userId", "status");

-- CreateIndex
CREATE INDEX "CopyTrade_traderId_status_idx" ON "CopyTrade"("traderId", "status");

-- CreateIndex
CREATE INDEX "CopyTrade_status_idx" ON "CopyTrade"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CopyTrade_signalId_subscriptionId_key" ON "CopyTrade"("signalId", "subscriptionId");

-- CreateIndex
CREATE INDEX "CopyTrader_status_idx" ON "CopyTrader"("status");

-- AddForeignKey
ALTER TABLE "CopySignal" ADD CONSTRAINT "CopySignal_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "CopyTrader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopySignal" ADD CONSTRAINT "CopySignal_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrade" ADD CONSTRAINT "CopyTrade_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "CopySignal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrade" ADD CONSTRAINT "CopyTrade_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "CopySubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrade" ADD CONSTRAINT "CopyTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrade" ADD CONSTRAINT "CopyTrade_traderId_fkey" FOREIGN KEY ("traderId") REFERENCES "CopyTrader"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CopyTrade" ADD CONSTRAINT "CopyTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

