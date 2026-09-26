import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { RATE_LIMITS } from "@/lib/security/rate-limit";
import { prisma } from "@/lib/db/prisma";
import { createApiKey } from "@/lib/auth/api-keys";
import { confirmSensitiveAction } from "@/lib/auth/confirm";
import { notify } from "@/lib/notifications/service";

export const GET = route({ auth: "user" }, async ({ session }) => {
  if (session.id.startsWith("apikey:")) throw new AppError("FORBIDDEN");
  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, createdAt: true },
  });
  return keys;
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(40),
  scopes: z.array(z.enum(["read", "trade"])).min(1),
  code: z.string().max(12).optional(),
  password: z.string().max(128).optional(),
});

export const POST = route({ auth: "verified", body: createSchema, rateLimit: RATE_LIMITS.money }, async ({ session, body }) => {
  if (session.id.startsWith("apikey:")) throw new AppError("FORBIDDEN");
  const count = await prisma.apiKey.count({ where: { userId: session.user.id, revokedAt: null } });
  if (count >= 5) throw new AppError("CONFLICT", "You can have at most 5 active API keys.");
  await confirmSensitiveAction(session.user.id, { code: body.code, password: body.password });
  const { key, plain } = await createApiKey(session.user.id, body.name, body.scopes);
  await notify({
    userId: session.user.id,
    type: "SECURITY_ALERT",
    title: "API key created",
    body: `Key "${body.name}" (${body.scopes.join(", ")}) was created.`,
    link: "/dashboard/settings?tab=api",
  });
  return { key, secret: plain };
});
