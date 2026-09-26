import { z } from "zod";
import { route } from "@/lib/api/route";
import { AppError } from "@/lib/api/errors";
import { getAllSettings, setSetting, SETTING_SCHEMAS } from "@/lib/services/settings";
import { audit } from "@/lib/services/audit";
import { isDemoMode } from "@/lib/config";

export const GET = route({ admin: "settings.manage" }, async () => ({ settings: await getAllSettings(), mode: isDemoMode() ? "demo" : "live" }));

const body = z.object({ key: z.string(), value: z.unknown() });

export const PUT = route({ admin: "settings.manage", body }, async ({ session, body, ip }) => {
  if (!(body.key in SETTING_SCHEMAS)) throw new AppError("NOT_FOUND", "Unknown setting.");
  const key = body.key;
  if (key === "company.profile" && session.user.adminUser?.role !== "SUPER_ADMIN") {
    throw new AppError("FORBIDDEN", "Only a super admin can change verified company information.");
  }
  await setSetting(key, body.value, session.user.id);
  await audit({
    actorId: session.user.id,
    actorEmail: session.user.email,
    ip,
    action: "setting.update",
    targetType: "SystemSetting",
    targetId: key,
    metadata: { value: body.value },
  });
  return { ok: true };
});
