import "server-only";
import { prisma } from "@/lib/db/prisma";
import { runMatchingCycle } from "@/lib/trading/order-service";
import { processDepositQueue } from "@/lib/payments/deposit-service";
import { processInvestmentQueue } from "@/lib/services/investments";
import { snapshotPortfolio } from "@/lib/trading/portfolio-service";
import { runCopyEngine } from "@/lib/services/copy-trading";
import { runBotCycle, runBotExits } from "@/lib/autobot/engine";
import { processBots } from "@/lib/services/bots";
import { IDLE_TIMEOUT_MS } from "@/lib/auth/session";

const jobs = [
  { name: "order-matching", everyMs: 3_000, run: runMatchingCycle },
  { name: "trading-bots", everyMs: 15_000, run: processBots },
  { name: "deposit-queue", everyMs: 5_000, run: processDepositQueue },
  { name: "investment-queue", everyMs: 30_000, run: processInvestmentQueue },
  // Copy trading: execute signals, take-profit/stop-loss, stop-copy thresholds.
  { name: "copy-engine", everyMs: 5_000, run: runCopyEngine },
  // Automated trading bot: SMC/ICT analysis and entries; stop-loss / take-profit exits.
  { name: "autobot-scan", everyMs: 30_000, run: runBotCycle },
  { name: "autobot-exits", everyMs: 5_000, run: runBotExits },
  {
    name: "portfolio-snapshots",
    everyMs: 60 * 60_000,
    run: async () => {
      const users = await prisma.user.findMany({
        where: { status: "ACTIVE", wallets: { some: { OR: [{ available: { gt: 0 } }, { locked: { gt: 0 } }] } } },
        select: { id: true, isDemo: true },
        take: 5_000,
      });
      for (const u of users) await snapshotPortfolio(u.id, u.isDemo).catch(() => {});
    },
  },
  {
    name: "session-cleanup",
    everyMs: 60 * 60_000,
    run: async () => {
      // Sign out sessions idle for 48 hours so they disappear from "active sessions" lists.
      await prisma.session.updateMany({ where: { revokedAt: null, lastSeenAt: { lt: new Date(Date.now() - IDLE_TIMEOUT_MS) } }, data: { revokedAt: new Date() } });
      await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
      await prisma.verificationToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
    },
  },
];

const g = globalThis;

export function startScheduler() {
  if (g.__hfScheduler) return;
  g.__hfScheduler = true;
  for (const job of jobs) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (err) {
        console.error(`[scheduler] ${job.name} failed:`, err instanceof Error ? err.message : err);
      } finally {
        running = false;
      }
    };
    setInterval(tick, job.everyMs).unref?.();
    setTimeout(tick, 5_000).unref?.();
  }
  console.info(`[scheduler] started ${jobs.length} jobs`);
}
