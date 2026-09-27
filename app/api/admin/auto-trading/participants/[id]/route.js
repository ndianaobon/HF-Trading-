import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { setParticipantStatus } from "@/lib/autobot/engine";

const body = z.object({
  action: z.enum(["activate", "pause", "stop"]),
  reason: z.string().trim().max(300).optional(),
  closePositions: z.boolean().optional(),
});

export const PATCH = route({ admin: "autobot.manage", body }, async ({ session, params, body, ip }) => {
  const p = await prisma.autoBotParticipant.findUnique({ where: { id: params.id } });
  if (!p) throw new AppError("NOT_FOUND");
  const status = { activate: "ACTIVE", pause: "PAUSED", stop: "STOPPED" }[body.action];
  return setParticipantStatus(p.userId, status, { actor: { id: session.user.id, email: session.user.email, ip }, reason: body.reason, closePositions: !!body.closePositions });
});
