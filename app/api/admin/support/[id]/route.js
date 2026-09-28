import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { addMessage, readMessageRequest, uploadAttachments } from "@/lib/services/support";
import { audit } from "@/lib/services/audit";

export const GET = route({ admin: "support.read" }, async ({ params }) => {
  const t = await prisma.supportTicket.findUnique({
    where: { id: params.id },
    include: {
      user: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
      assignedTo: { select: { id: true, email: true } },
      messages: { orderBy: { createdAt: "asc" }, include: { author: { select: { email: true } } } },
    },
  });
  if (!t) throw new AppError("NOT_FOUND");
  return t;
});

/** Staff reply: text and/or up to 3 files (multipart "files"), stored with the customer's files. */
export const POST = route({ admin: "support.reply" }, async ({ session, params, req }) => {
  const t = await prisma.supportTicket.findUnique({ where: { id: params.id } });
  if (!t) throw new AppError("NOT_FOUND");
  const { body, files } = await readMessageRequest(req);
  const attachments = await uploadAttachments(t.userId, files);
  if (!t.assignedToId) await prisma.supportTicket.update({ where: { id: t.id }, data: { assignedToId: session.user.id } });
  return addMessage(params.id, { id: session.user.id, isStaff: true }, body, attachments);
});

const patch = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignToMe: z.boolean().optional(),
});

export const PATCH = route({ admin: "support.reply", body: patch }, async ({ session, params, body, ip }) => {
  const t = await prisma.supportTicket.update({
    where: { id: params.id },
    data: {
      ...(body.status ? { status: body.status } : {}),
      ...(body.priority ? { priority: body.priority } : {}),
      ...(body.assignToMe ? { assignedToId: session.user.id } : {}),
    },
  });
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: "support.ticket.update",
    targetType: "SupportTicket",
    targetId: t.id,
    metadata: body,
  });
  return t;
});
