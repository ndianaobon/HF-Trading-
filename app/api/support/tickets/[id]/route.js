import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { messageSchema } from "@/lib/validation/schemas";
import { addMessage, uploadAttachments } from "@/lib/services/support";
import { prisma } from "@/lib/db/prisma";

export const GET = route({ auth: "user" }, async ({ session, params }) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: params.id },
    include: {
      messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { profile: { select: { firstName: true } } } } } },
      assignedTo: { select: { profile: { select: { firstName: true } } } },
    },
  });
  if (!ticket || ticket.userId !== session.user.id) throw new AppError("NOT_FOUND");
  return {
    ...ticket,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      body: m.body,
      isStaff: m.isStaff,
      attachments: m.attachments,
      createdAt: m.createdAt,
      authorName: m.isStaff ? `${m.author.profile?.firstName ?? "Support"} · HarborFinance` : "You",
    })),
  };
});

/** Reply (multipart with optional files, or JSON). */
export const POST = route({ auth: "user", rateLimit: RATE_LIMITS.support }, async ({ session, params, req }) => {
  const type = req.headers.get("content-type") ?? "";
  let body;
  let files = [];
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    body = messageSchema.parse({ body: form.get("body") }).body;
    files = form.getAll("files").filter((f) => f instanceof File && f.size > 0);
  } else {
    body = messageSchema.parse(await req.json()).body;
  }
  const attachments = await uploadAttachments(session.user.id, files);
  return addMessage(params.id, { id: session.user.id, isStaff: false }, body, attachments);
});

export const PATCH = route({ auth: "user", body: z.object({ status: z.enum(["CLOSED"]) }) }, async ({ session, params }) => {
  const { count } = await prisma.supportTicket.updateMany({ where: { id: params.id, userId: session.user.id }, data: { status: "CLOSED" } });
  if (!count) throw new AppError("NOT_FOUND");
  return { status: "CLOSED" };
});
