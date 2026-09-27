import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { prisma } from "@/lib/db/prisma";
import { storage } from "@/lib/storage";

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Lead trader profile image (public). */
export const GET = route({ auth: "none" }, async ({ params }) => {
  const t = await prisma.copyTrader.findUnique({ where: { id: params.id }, select: { avatarKey: true, deletedAt: true } });
  if (!t?.avatarKey || t.deletedAt) throw new AppError("NOT_FOUND");
  const data = await storage()
    .get(t.avatarKey)
    .catch(() => {
      throw new AppError("NOT_FOUND");
    });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": TYPES[t.avatarKey.split(".").pop()] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
});
