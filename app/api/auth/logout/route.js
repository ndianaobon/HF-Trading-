import { route } from "@/lib/api/route";
import { clearSessionCookie, getRawSession, revokeSession } from "@/lib/auth/session";

export const POST = route({ auth: "none" }, async () => {
  const session = await getRawSession();
  if (session) await revokeSession(session.id);
  await clearSessionCookie();
  return { ok: true };
});
