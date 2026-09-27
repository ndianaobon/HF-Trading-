import { NextResponse } from "next/server";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Edge middleware:
 *  1. CSRF: state-changing API requests must come from our own origin
 *     (cookies are SameSite=Lax as a second layer). API-key requests carry no
 *     cookies and are exempt.
 *
 * Signed-out visitors to /dashboard and /admin are redirected to /login by the
 * page router (lib/views/serve-page.js), with a relative Location so the
 * redirect stays on the public domain behind a proxy.
 */
export function middleware(req) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/") && !SAFE_METHODS.has(req.method)) {
    const bearer = req.headers.get("authorization")?.startsWith("Bearer ");
    if (!bearer) {
      const origin = req.headers.get("origin");
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
      let ok = false;
      if (origin && host) {
        try {
          ok = new URL(origin).host === host;
        } catch {
          ok = false;
        }
      }
      if (!ok) {
        return NextResponse.json({ error: { code: "CSRF_FAILED", message: "Request origin could not be verified." } }, { status: 403 });
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
