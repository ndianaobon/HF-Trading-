import { route } from "@/lib/api/route";
import { revokeAllSessions } from "@/lib/auth/session";
import { audit } from "@/lib/services/audit";

/** Sign out of every other session. */
export const DELETE = route({ auth: "user" }, async ({ session, ip }) => {
  await revokeAllSessions(session.user.id, session.id);
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    action: "security.sessions.revoke_all",
    targetType: "User",
    targetId: session.user.id,
    ip,
  });
  return { revoked: true };
});
