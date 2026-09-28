import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { can } from "@/lib/auth/rbac";
import { storage } from "@/lib/storage";
import { audit } from "@/lib/services/audit";

const query = z.object({ key: z.string().regex(/^(kyc|support|deposit)\/[a-z0-9]+\/[A-Za-z0-9._-]+$/, "Invalid file key") });

const TYPES = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" };
const AUDIT_ACTION = { kyc: "kyc.document.view", support: "support.attachment.view", deposit: "deposit.proof.view" };

/** Private file access: owners, or any active staff member (every staff view is audited). */
export const GET = route({ auth: "user", query }, async ({ session, query, ip }) => {
  const [area, ownerId] = query.key.split("/");
  const admin = session.user.adminUser;
  const isOwner = ownerId === session.user.id;
  const staffOk = !!admin?.isActive && can(admin.role, "users.read");
  if (!isOwner && !staffOk) throw new AppError("NOT_FOUND");

  const data = await storage()
    .get(query.key)
    .catch(() => {
      throw new AppError("NOT_FOUND");
    });
  if (!isOwner) {
    await audit({ actorId: session.user.id, actorEmail: session.user.email, action: AUDIT_ACTION[area], targetType: "User", targetId: ownerId, ip, metadata: { key: query.key } });
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
