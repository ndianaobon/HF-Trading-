import { route } from "@/lib/api/route";
import { toClientUser } from "@/lib/services/users";

/** Signed-in user or null. Used by public pages to adapt navigation without a 401. */
export const GET = route({ auth: "optional" }, async ({ session }) => (session ? toClientUser(session) : null));
