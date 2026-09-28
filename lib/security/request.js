import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/config";

/**
 * Client IP for rate limits and logs. The leftmost X-Forwarded-For entries can
 * be set by the client, so the IP is read TRUSTED_PROXY_HOPS entries from the
 * right — the address our own proxy saw.
 */
export function clientIp(h) {
  const hops = env().TRUSTED_PROXY_HOPS;
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const ip = hops > 0 && chain.length ? chain[Math.max(0, chain.length - hops)] : h.get("x-real-ip");
  return (ip ?? "127.0.0.1").trim().slice(0, 64);
}

export async function requestMeta() {
  const h = await headers();
  const ip = clientIp(h);
  const userAgent = (h.get("user-agent") ?? "unknown").slice(0, 400);
  return { ip, userAgent };
}

/** Short description of a user agent for session lists, e.g. "Chrome on Windows". */
export function describeUserAgent(ua) {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Firefox\//.test(ua)
          ? "Firefox"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} on ${os}`;
}
