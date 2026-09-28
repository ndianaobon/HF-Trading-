import { headers } from "next/headers";
import { route } from "@/lib/api/route";
import { env } from "@/lib/config";

/**
 * Shows how the proxy chain reaches the app, to confirm TRUSTED_PROXY_HOPS:
 * `ip` should be the admin's own public IP.
 */
export const GET = route({ admin: "settings.manage" }, async ({ ip }) => {
  const h = await headers();
  return { ip, xForwardedFor: h.get("x-forwarded-for"), xRealIp: h.get("x-real-ip"), trustedProxyHops: env().TRUSTED_PROXY_HOPS };
});
