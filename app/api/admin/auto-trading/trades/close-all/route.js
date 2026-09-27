import { route } from "@/lib/api/route";
import { prisma } from "@/lib/db/prisma";
import { closeBotTrade } from "@/lib/autobot/engine";

/** Emergency: close every open bot position at market. */
export const POST = route({ admin: "autobot.manage" }, async ({ session, ip }) => {
  const actor = { id: session.user.id, email: session.user.email, ip };
  const open = await prisma.autoBotTrade.findMany({ where: { status: "OPEN" }, select: { id: true } });
  let closed = 0;
  const failed = [];
  for (const t of open) {
    const r = await closeBotTrade(t.id, "MANUAL", actor).catch((err) => ({ closed: false, error: err.message }));
    if (r.closed) closed++;
    else failed.push(r.error ?? "in progress");
  }
  return { total: open.length, closed, failed: failed.length, firstError: failed[0] ?? null };
});
