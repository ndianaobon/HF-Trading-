import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";

export const DELETE = route({ auth: "user" }, async ({ session, params }) => {
  if (session.id.startsWith("apikey:")) throw new AppError("FORBIDDEN");
  const { count } = await prisma.apiKey.updateMany({ where: { id: params.id, userId: session.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!count) throw new AppError("NOT_FOUND");
  return { revoked: true };
});
