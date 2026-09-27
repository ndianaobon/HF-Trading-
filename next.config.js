import { readFileSync } from "node:fs";

const isDev = process.env.NODE_ENV !== "production";

// Asset version written by scripts/build-frontend.js (runs before `next build`).
let assetVersion = null;
try {
  assetVersion = JSON.parse(readFileSync(new URL("./views/asset-version.json", import.meta.url), "utf8")).version;
} catch {
  assetVersion = null;
}

// Market data is streamed directly from the public provider in the browser;
// everything else is same-origin.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://data-api.binance.vision wss://data-stream.binance.vision" + (isDev ? " ws://localhost:* ws://127.0.0.1:*" : ""),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig = {
  // Overridable so a production build can be verified alongside a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@node-rs/argon2", "embedded-postgres", "nodemailer"],
  // Pages are plain HTML views served by app/[...path]/route.js; include them in output tracing.
  outputFileTracingIncludes: { "/[...path]": ["./views/**/*"], "/": ["./views/**/*"], "/opengraph-image": ["./lib/brand/*.ttf"], "/twitter-image": ["./lib/brand/*.ttf"] },
  // Versioned asset URLs (/assets/v/<hash>/…, written into pages by the frontend
  // build) map to the real files, so each deploy that changes assets gets new URLs.
  async rewrites() {
    return [{ source: "/assets/v/:version/:path*", destination: "/assets/:path*" }];
  },
  async headers() {
    const cache = (value) => [{ key: "Cache-Control", value }];
    return [
      { source: "/:path*", headers: securityHeaders },
      // Production only: the CDN and browsers keep versioned assets for a year;
      // unversioned files are cached briefly.
      ...(isDev
        ? []
        : [
            // Only this build's version is immutable. Any other version (e.g. requested
            // from an older/newer instance during a rolling deploy) is never cached, so a
            // mismatched response can't stick in the CDN. The later rule wins.
            { source: "/assets/v/:path*", headers: cache("no-cache") },
            ...(assetVersion ? [{ source: `/assets/v/${assetVersion}/:path*`, headers: cache("public, max-age=31536000, immutable") }] : []),
            { source: "/vendor/:path*", headers: cache("public, max-age=86400, stale-while-revalidate=604800") },
            { source: "/brand/:path*", headers: cache("public, max-age=86400, stale-while-revalidate=604800") },
            { source: "/favicon.svg", headers: cache("public, max-age=86400") },
          ]),
    ];
  },
};

export default nextConfig;
