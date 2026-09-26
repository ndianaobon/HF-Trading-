const isDev = process.env.NODE_ENV !== "production";

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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
