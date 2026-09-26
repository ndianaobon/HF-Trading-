import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { broadcastAnnouncement, notify } from "@/lib/notifications/service";
import { audit } from "@/lib/services/audit";

export const GET = route({ admin: "notifications.send" }, async () =>
  prisma.auditLog.findMany({ where: { action: { in: ["notification.broadcast", "notification.direct"] } }, orderBy: { createdAt: "desc" }, take: 30 }),
);

const body = z.object({
  audience: z.enum(["all", "user"]),
  email: z.string().email().optional(),
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(3).max(1000),
  link: z
    .string()
    .trim()
    .regex(/^\/[A-Za-z0-9/_?=&-]*$/, "Use a relative link, e.g. /dashboard")
    .optional()
    .or(z.literal("")),
});

export const POST = route({ admin: "notifications.send", body }, async ({ session, body, ip }) => {
  let recipients = 0;
  if (body.audience === "all") {
    recipients = await broadcastAnnouncement(body.title, body.body, body.link || undefined);
  } else {
    const user = body.email ? await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } }) : null;
    if (!user) throw new AppError("NOT_FOUND", "No user with that email.");
    await notify({ userId: user.id, type: "SYSTEM_ANNOUNCEMENT", title: body.title, body: body.body, link: body.link || undefined });
    recipients = 1;
  }
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: body.audience === "all" ? "notification.broadcast" : "notification.direct",
    targetType: "Notification",
    metadata: { title: body.title, body: body.body, recipients, email: body.email },
  });
  return { recipients };
});
