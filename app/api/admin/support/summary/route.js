import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";

/**
 * Conversations waiting for a staff reply (a customer wrote last: OPEN or
 * IN_PROGRESS), split into live chat and tickets. Polled by the admin shell.
 */
export const GET = route({ admin: "support.read" }, async () => {
  const rows = await prisma.supportTicket.groupBy({ by: ["category"], where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, _count: { _all: true } });
  const chat = rows.filter((r) => r.category === "LIVE_CHAT").reduce((a, r) => a + r._count._all, 0);
  const total = rows.reduce((a, r) => a + r._count._all, 0);
  return { awaitingReply: total, liveChat: chat, tickets: total - chat };
});
