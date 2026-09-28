import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { can } from "@/lib/auth/rbac";
import { storage } from "@/lib/storage";
import { audit } from "@/lib/services/audit";

const query = z.object({ key: z.string().regex(/^(kyc|support|deposit)\/[a-z0-9]+\/[A-Za-z0-9._-]+$/, "Invalid file key") });

// Staff permission needed to open another user's file in each area.
const STAFF_PERMISSION = { kyc: "kyc.read", support: "support.read", deposit: "deposits.read" };

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };

/** Private file access: owners, or staff with the matching permission. */
export const GET = route({ auth: "user", query }, async ({ session, query, ip }) => {
  const [area, ownerId] = query.key.split("/");
  const admin = session.user.adminUser;
  const isOwner = ownerId === session.user.id;
  const staffOk = can(admin?.role, STAFF_PERMISSION[area]);
  if (!isOwner && !staffOk) throw new AppError("NOT_FOUND");

  const data = await storage()
    .get(query.key)
    .catch(() => {
      throw new AppError("NOT_FOUND");
    });
  if (!isOwner && area === "kyc") {
    await audit({ actorId: session.user.id, actorEmail: session.user.email, action: "kyc.document.view", targetType: "KycDocument", targetId: query.key, ip });
  }
  const ext = query.key.split(".").pop() ?? "";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Disposition": `inline; filename="${query.key.split("/").pop()}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
    },
  });
});
