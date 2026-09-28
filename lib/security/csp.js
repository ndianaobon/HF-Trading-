// Content-Security-Policy shared by next.config.js (HTTP header) and the
// frontend build (a <meta> copy in every page, because Hostinger's proxy
// replaces the header with its own "upgrade-insecure-requests").
// Market data is streamed directly from the public provider in the browser;
// everything else is same-origin. No inline scripts are allowed.

export function buildCsp({ dev = false, meta = false } = {}) {
  return [
    "default-src 'self'",
    `script-src 'self'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://data-api.binance.vision wss://data-stream.binance.vision" + (dev ? " ws://localhost:* ws://127.0.0.1:*" : ""),
    // frame-ancestors is ignored in <meta>; X-Frame-Options: DENY covers framing there.
    ...(meta ? [] : ["frame-ancestors 'none'"]),
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}
