import { route } from "@/lib/api/route";
import { updateSignal } from "@/lib/services/copy-trading";
import { signalUpdateSchema } from "@/lib/validation/admin";

/** { action: "activate" | "cancel" | "close" | "edit", ...fields } */
export const PATCH = route({ admin: "copytraders.manage", body: signalUpdateSchema }, async ({ session, params, body, ip }) =>
  updateSignal(params.id, body, { id: session.user.id, email: session.user.email, ip }),
);
