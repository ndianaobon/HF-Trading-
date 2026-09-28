import { z } from "zod";
import { route } from "@/lib/api/route";
import { editStaffMessage } from "@/lib/services/support";

/** Edit a support reply (staff messages only; the original is kept in the audit log). */
export const PATCH = route({ admin: "support.reply", body: z.object({ body: z.string().trim().min(1).max(5000) }) }, async ({ session, params, body, ip }) =>
  editStaffMessage(params.id, body.body, { id: session.user.id, email: session.user.email, ip }),
);
