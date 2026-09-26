import { route } from "@/lib/api/route";
import { toClientUser } from "@/lib/services/users";

export const GET = route({ auth: "user" }, async ({ session }) => toClientUser(session));
