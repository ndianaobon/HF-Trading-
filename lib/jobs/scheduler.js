import "server-only";
import { prisma } from "@/lib/db/prisma";
import { runMatchingCycle } from "@/lib/trading/order-service";
import { processDepositQueue } from "@/lib/payments/deposit-service";
import { processInvestmentQueue } from "@/lib/services/investments";
import { snapshotPortfolio } from "@/lib/trading/portfolio-service";
import { stopCopying } from "@/lib/services/copy-trading";
import { processBots } from "@/lib/services/bots";

const jobs = [
  { name: "order-matching", everyMs: 3_000, run: runMatchingCycle },
  { name: "trading-bots", everyMs: 15_000, run: processBots },
  { name: "deposit-queue", everyMs: 5_000, run: processDepositQueue },
  { name: "investment-queue", everyMs: 30_000, run: processInvestmentQueue },
  {
    // Enforce each copy relationship's stop-copy threshold against its recorded P&L.
    name: "copy-stop-threshold",
    everyMs: 60_000,
    run: async () => {
      const subs = await prisma.copySubscription.findMany({ where: { status: { in: ["ACTIVE", "PAUSED"] }, pnl: { lt: 0 } }, take: 500 });
      for (const s of subs) {
        const limit = s.allocation.mul(s.stopLossPct).div(100);
        if (s.pnl.neg().gte(limit)) await stopCopying(s.userId, s.id).catch(() => {});
      }
    },
  },
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
