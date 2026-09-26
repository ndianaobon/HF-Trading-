import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { revokeSession } from "@/lib/auth/session";

export const DELETE = route({ auth: "user" }, async ({ session, params }) => {
  const target = await prisma.session.findUnique({ where: { id: params.id } });
  if (!target || target.userId !== session.user.id) throw new AppError("NOT_FOUND");
  await revokeSession(target.id);
  return { revoked: true, current: target.id === session.id };
});
