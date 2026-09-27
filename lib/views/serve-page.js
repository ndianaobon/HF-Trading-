import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getRawSession, getSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { isProduction } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";

/**
 * Serves the static HTML views built from /frontend (see scripts/build-frontend.js).
 * Views live outside /public so access rules are enforced here on the server:
 *   /dashboard/**  → requires a fully authenticated session (redirects to /login)
 *   /admin/**      → requires an active admin with the page's permission (404 otherwise)
 *   /login, /register → redirect signed-in users to the dashboard
 */
const VIEWS = path.join(process.cwd(), "views");

const DYNAMIC = [
  [/^\/trade\/[A-Za-z0-9]{2,10}-[A-Za-z]{3,5}$/, "trade.html"],
  [/^\/copy-trading\/[a-z0-9-]{2,40}$/, "copy-trading/trader.html"],
  [/^\/dashboard\/copy-trading\/[a-z0-9-]{2,40}$/, "dashboard/copy-trading/trader.html"],
  [/^\/dashboard\/support\/[a-z0-9]{10,40}$/, "dashboard/support/ticket.html"],
  [/^\/admin\/users\/[a-z0-9]{10,40}$/, "admin/users/detail.html"],
];

/** Admin page → permission required (mirrors the admin navigation). */
const ADMIN_PERMISSIONS = {
  "/admin": "users.read",
  "/admin/users": "users.read",
  "/admin/kyc": "kyc.read",
  "/admin/wallets": "wallets.read",
  "/admin/deposits": "deposits.read",
  "/admin/withdrawals": "withdrawals.read",
  "/admin/transactions": "transactions.read",
  "/admin/trades": "trades.read",
  "/admin/markets": "trades.read",
  "/admin/investment-plans": "plans.manage",
  "/admin/copy-traders": "copytraders.manage",
  "/admin/referrals": "referrals.manage",
  "/admin/support": "support.read",
  "/admin/notifications": "notifications.send",
  "/admin/reports": "reports.read",
  "/admin/settings": "settings.manage",
  "/admin/audit-logs": "audit.read",
};

const cache = new Map();

async function readView(rel) {
  if (isProduction() && cache.has(rel)) return cache.get(rel);
  try {
    const html = await fs.readFile(path.join(VIEWS, rel), "utf8");
    if (isProduction()) cache.set(rel, html);
    return html;
  } catch {
    return null;
  }
}

async function resolveFile(pathname) {
  if (!/^\/[a-z0-9\-/]*$/i.test(pathname) || pathname.includes("..")) return null;
  for (const [re, file] of DYNAMIC) if (re.test(pathname)) return file;
  const clean = pathname.replace(/\/+$/, "");
  const candidates = clean === "" ? ["index.html"] : [`${clean.slice(1)}.html`, `${clean.slice(1)}/index.html`];
  for (const c of candidates) {
    if (c.endsWith("/trader.html") || c.endsWith("/ticket.html") || c.endsWith("/detail.html")) continue; // templates for dynamic routes
    if (await readView(c)) return c;
  }
  return null;
}

const html = (body, status = 200, cacheControl = "no-store") =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": cacheControl } });

async function notFound() {
  return html((await readView("404.html")) ?? "<h1>Not found</h1>", 404);
}

export async function servePage(req) {
  const url = new URL(req.url);
  const pathname = url.pathname === "/" ? "/" : url.pathname.replace(/\/+$/, "");
  const redirect = (to) => NextResponse.redirect(new URL(to, url));
  const next = encodeURIComponent(pathname + url.search);

  if (pathname === "/trade") {
    const session = await getSession();
    const pref = session?.user.profile?.preferences?.defaultMarket;
    return redirect(`/trade/${pref && /^[A-Z0-9]{2,10}-[A-Z]{3,5}$/.test(pref) ? pref : "BTC-USDT"}`);
  }

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/admin")) {
    const raw = await getRawSession();
    if (!raw) return redirect(`/login?next=${next}`);
    if (raw.user.twoFactor?.enabled && !raw.mfaVerified) return redirect(`/login/verify?next=${next}`);
    if (pathname.startsWith("/admin")) {
      const admin = raw.user.adminUser;
      const base = pathname.startsWith("/admin/users/") ? "/admin/users" : pathname;
      const perm = ADMIN_PERMISSIONS[base];
      if (!admin?.isActive || !perm || !can(admin.role, perm)) return notFound();
      if (!raw.user.twoFactor?.enabled) return redirect("/dashboard/settings?tab=security");
    }
  }

  if (pathname === "/login" || pathname === "/register") {
    if (await getSession()) return redirect("/dashboard");
  }
  if (pathname === "/login/verify") {
    const raw = await getRawSession();
    if (!raw) return redirect("/login");
  }

  const file = await resolveFile(pathname);
  if (!file) return notFound();

  // Dynamic pages for records that don't exist get a real 404 (not an empty shell).
  const tradeMatch = pathname.match(/^\/trade\/([A-Za-z0-9]{2,10}-[A-Za-z]{3,5})$/);
  if (tradeMatch) {
    const market = await prisma.market.findUnique({ where: { symbol: tradeMatch[1].toUpperCase() }, select: { status: true } });
    if (!market || market.status === "DELISTED") return notFound();
  }
  const traderMatch = pathname.match(/^\/(?:dashboard\/)?copy-trading\/([a-z0-9-]{2,40})$/);
  if (traderMatch) {
    const trader = await prisma.copyTrader.findUnique({ where: { slug: traderMatch[1] }, select: { isActive: true } });
    // Hidden traders stay reachable from the dashboard for existing copiers.
    if (!trader || (!trader.isActive && !pathname.startsWith("/dashboard"))) return notFound();
  }
  const body = await readView(file);
  const isPrivate = pathname.startsWith("/dashboard") || pathname.startsWith("/admin");
  return html(body, 200, isPrivate ? "private, no-store" : "public, max-age=0, must-revalidate");
}
