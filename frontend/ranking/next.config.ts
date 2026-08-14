import type { NextConfig } from "next";

/**
 * Security headers on every response. CSP notes:
 *  - script-src needs 'unsafe-inline' for Next's own bootstrap scripts.
 *  - frame-ancestors 'none' replaces X-Frame-Options.
 *  - connect-src 'self' — the app talks only to itself; payments happen on
 *    Dodo's hosted checkout page, not via scripts here.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // React's dev tooling needs eval; production never gets it.
      process.env.NODE_ENV === "production"
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      // The sources page loads site icons from Google's favicon service,
      // which redirects www.google.com/s2 -> t*.gstatic.com, and CSP checks
      // the redirect target too. Images only - no scripts or connections.
      "img-src 'self' data: blob: https://www.google.com https://*.gstatic.com",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
