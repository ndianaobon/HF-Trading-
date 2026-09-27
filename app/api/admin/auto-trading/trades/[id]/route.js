import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { closeBotTrade } from "@/lib/autobot/engine";

/** Manually close one bot position at market. */
export const PATCH = route({ admin: "autobot.manage", body: z.object({ action: z.literal("close") }) }, async ({ session, params, ip }) => {
  const res = await closeBotTrade(params.id, "MANUAL", { id: session.user.id, email: session.user.email, ip });
  if (!res.closed) throw new AppError("CONFLICT", res.error ?? (res.row?.status === "OPEN" ? "The position is already being closed." : "This position is not open."));
  return res.row;
});
