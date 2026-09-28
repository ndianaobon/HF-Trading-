import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { env, isProduction } from "@/lib/config";

const querySchema = z.object({ email: z.string().email() });

/**
 * DEVELOPMENT ONLY — lets you read emails captured by the "console" email
 * provider (verification and reset links). Disabled in production and
 * whenever a real email provider is configured.
 */
export const GET = route({ auth: "none" }, async ({ req }) => {
  if (isProduction() || env().EMAIL_PROVIDER !== "console") throw new AppError("NOT_FOUND");
  const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  const emails = await prisma.emailOutbox.findMany({
    where: { to: query.email.toLowerCase() },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, subject: true, text: true, createdAt: true },
  });
  return emails.map((e) => ({ ...e, links: [...e.text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]) }));
});
