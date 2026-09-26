const BASE = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

export default function robots() {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/dashboard", "/admin", "/verify-email", "/reset-password", "/login/verify"] }],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
