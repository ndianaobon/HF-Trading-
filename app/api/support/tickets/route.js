import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { ticketSchema } from "@/lib/validation/schemas";
import { createTicket, uploadAttachments } from "@/lib/services/support";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "user" }, async ({ session }) =>
  prisma.supportTicket.findMany({
    where: { userId: session.user.id, category: { not: "LIVE_CHAT" } },
    orderBy: { lastMessageAt: "desc" },
    include: { _count: { select: { messages: true } } },
  }),
);

/** Multipart: subject, category, priority, message, files[] */
export const POST = route({ auth: "user", rateLimit: RATE_LIMITS.support }, async ({ session, req }) => {
  let form;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid form submission.");
  }
  const fields = ticketSchema.parse({
    subject: form.get("subject"),
    category: form.get("category"),
    priority: form.get("priority"),
    message: form.get("message"),
  });
  const files = form.getAll("files").filter((f) => f instanceof File && f.size > 0);
  const attachments = await uploadAttachments(session.user.id, files);
  const ticket = await createTicket(session.user.id, { ...fields, attachments });
  return { id: ticket.id, number: ticket.number };
});
