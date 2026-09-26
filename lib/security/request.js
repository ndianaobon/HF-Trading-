import "server-only";
import { headers } from "next/headers";

export async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = (forwarded?.split(",")[0] ?? h.get("x-real-ip") ?? "127.0.0.1").trim();
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
