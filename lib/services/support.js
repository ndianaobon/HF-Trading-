import "server-only";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/api/errors";
import { storeUpload } from "@/lib/storage";
import { notify } from "@/lib/notifications/service";
import { publish } from "@/lib/realtime/bus";

/**
 * Reads a message and optional files from a JSON or multipart request. A message
 * may be text, files, or both.
 */
export async function readMessageRequest(req) {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const files = form.getAll("files").filter((f) => typeof f === "object" && f.size > 0);
    const body = String(form.get("body") ?? "").trim();
    if (!body && !files.length) throw new AppError("VALIDATION_ERROR", "Write a message or attach a file.");
    if (body.length > 5000) throw new AppError("VALIDATION_ERROR", "Message is too long.");
    return { body, files };
  }
  const json = await req.json().catch(() => ({}));
  const body = String(json.body ?? "").trim();
  if (!body) throw new AppError("VALIDATION_ERROR", "Message cannot be empty.");
  if (body.length > 5000) throw new AppError("VALIDATION_ERROR", "Message is too long.");
  return { body, files: [] };
}

/** Staff can correct their own team's replies; customer messages are never editable. */
export async function editStaffMessage(messageId, body, actor) {
  const m = await prisma.supportMessage.findUnique({ where: { id: messageId }, include: { ticket: true } });
  if (!m) throw new AppError("NOT_FOUND");
  if (!m.isStaff) throw new AppError("FORBIDDEN", "Only support replies can be edited.");
  const text = body.trim();
  if (!text || text.length > 5000) throw new AppError("VALIDATION_ERROR", "Message must be 1–5000 characters.");
  const updated = await prisma.supportMessage.update({ where: { id: messageId }, data: { body: text, editedAt: new Date() } });
  await prisma.auditLog.create({
    data: { actorId: actor.id, actorEmail: actor.email, ip: actor.ip ?? null, action: "support.message.edit", targetType: "SupportMessage", targetId: messageId, metadata: { ticketId: m.ticketId, before: m.body, after: text } },
  });
  publish(m.ticket.userId, { type: "support.message", ticketId: m.ticketId });
  return updated;
}

export async function uploadAttachments(userId, files) {
  if (files.length > 3) throw new AppError("VALIDATION_ERROR", "You can attach up to 3 files.");
  const out = [];
  for (const f of files) out.push(await storeUpload(`support/${userId}`, f));
  return out;
}

export async function createTicket(userId, input) {
  return prisma.supportTicket.create({
    data: {
      userId,
      subject: input.subject,
      category: input.category,
      priority: input.priority,
      messages: { create: { authorId: userId, body: input.message, attachments: input.attachments } },
    },
  });
}

/** Returns the user's open live-chat conversation, creating one if needed. */
export async function liveChatThread(userId) {
  const existing = await prisma.supportTicket.findFirst({
    where: { userId, category: "LIVE_CHAT", status: { notIn: ["RESOLVED", "CLOSED"] } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.supportTicket.create({ data: { userId, subject: "Live chat", category: "LIVE_CHAT", priority: "NORMAL" } });
}

export async function addMessage(ticketId, author, body, attachments = []) {
  const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new AppError("NOT_FOUND");
  if (!author.isStaff && ticket.userId !== author.id) throw new AppError("NOT_FOUND");
  if (ticket.status === "CLOSED") throw new AppError("CONFLICT", "This ticket is closed. Please open a new ticket.");

  const nextStatus = author.isStaff ? "WAITING_FOR_USER" : ticket.assignedToId ? "IN_PROGRESS" : "OPEN";
  const [message] = await prisma.$transaction([
    prisma.supportMessage.create({ data: { ticketId, authorId: author.id, isStaff: author.isStaff, body, attachments: attachments } }),
    prisma.supportTicket.update({ where: { id: ticketId }, data: { status: nextStatus, lastMessageAt: new Date() } }),
  ]);
  publish(ticket.userId, { type: "support.message", ticketId });
  if (author.isStaff && ticket.category !== "LIVE_CHAT") {
    await notify({
      userId: ticket.userId,
      type: "SUPPORT_REPLY",
      title: `Reply on ticket #${ticket.number}`,
      body: ticket.subject,
      link: `/dashboard/support/${ticket.id}`,
    });
  }
  return message;
}
