import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { messageSchema } from "@/lib/validation/schemas";
import { addMessage, liveChatThread } from "@/lib/services/support";
import { getSetting } from "@/lib/services/settings";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "user" }, async ({ session }) => {
  const contact = await getSetting("support.contact");
  const existing = await prisma.supportTicket.findFirst({
    where: { userId: session.user.id, category: "LIVE_CHAT", status: { notIn: ["RESOLVED", "CLOSED"] } },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  return {
    enabled: contact.liveChatEnabled,
    hours: contact.hours || null,
    threadId: existing?.id ?? null,
    messages: (existing?.messages ?? []).map((m) => ({ id: m.id, body: m.body, isStaff: m.isStaff, createdAt: m.createdAt })),
  };
});

export const POST = route({ auth: "user", body: messageSchema, rateLimit: RATE_LIMITS.support }, async ({ session, body }) => {
  const contact = await getSetting("support.contact");
  if (!contact.liveChatEnabled) throw new AppError("FEATURE_DISABLED", "Live chat is currently offline. Please open a ticket.");
  const thread = await liveChatThread(session.user.id);
  const m = await addMessage(thread.id, { id: session.user.id, isStaff: false }, body.body);
  return { id: m.id, threadId: thread.id };
});
