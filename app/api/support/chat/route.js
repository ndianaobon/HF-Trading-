import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { addMessage, liveChatThread, readMessageRequest, uploadAttachments } from "@/lib/services/support";
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
    messages: (existing?.messages ?? []).map((m) => ({ id: m.id, body: m.body, isStaff: m.isStaff, attachments: m.attachments, editedAt: m.editedAt, createdAt: m.createdAt })),
  };
});

/** Send a chat message: text and/or up to 3 files (JPG, PNG, WEBP, PDF; multipart "files"). */
export const POST = route({ auth: "user", rateLimit: RATE_LIMITS.support }, async ({ session, req }) => {
  const contact = await getSetting("support.contact");
  if (!contact.liveChatEnabled) throw new AppError("FEATURE_DISABLED", "Live chat is currently offline. Please open a ticket.");
  const { body, files } = await readMessageRequest(req);
  const attachments = await uploadAttachments(session.user.id, files);
  const thread = await liveChatThread(session.user.id);
  const m = await addMessage(thread.id, { id: session.user.id, isStaff: false }, body, attachments);
  return { id: m.id, threadId: thread.id };
});
