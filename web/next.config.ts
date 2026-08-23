import type { NextConfig } from "next";

/* Isolated-build escape hatch (TASK-14, kept + justified): `T21_DISTDIR=1
   next build && T21_DISTDIR=1 next start -p 3001` runs a second build dir
   (.next-t21) so agents can verify changes against a live server without
   touching whatever is serving :3000. No effect in normal dev/prod. */
const isIsolatedBuild = process.env.T21_DISTDIR === "1";

/* Security headers (TASK-14). CSP notes: the client bundle is fully
   same-origin — fonts are self-hosted by next/font at build time, images are
   local (/kalyan/*.png), and all external hosts (Yahoo/Moneycontrol/Google/
   Groww) are contacted server-side only. 'unsafe-inline' on script/style is
   required by Next.js hydration + the pre-paint theme script in layout.tsx;
   revisit with a nonce-based middleware if the inline budget grows. */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
];

const nextConfig: NextConfig = {
  distDir: isIsolatedBuild ? ".next-t21" : undefined,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
