import { NextResponse } from "next/server";

const SESSION_COOKIE = "hf_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Edge middleware:
 *  1. CSRF: state-changing API requests must come from our own origin
 *     (cookies are SameSite=Lax as a second layer). API-key requests carry no
 *     cookies and are exempt.
 *  2. Fast redirect to /login for protected areas when no session cookie is
 *     present. Real authorisation happens server-side on every request.
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

  if ((pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) && !req.cookies.get(SESSION_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/dashboard/:path*", "/admin/:path*"],
};
