import path from "node:path";
import type { NextConfig } from "next";

// The repo root, so Turbopack and file tracing can reach ../../src/lib/engine.
const repoRoot = path.resolve(__dirname, "../..");

// Beacon Frontier metrics post to /api/m on this origin ('self'). A local test build can point them at a
// capture server with NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT; only then is that origin allowed as well.
const METRICS_DEBUG_ORIGIN = (() => {
  const endpoint = process.env.NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT;
  return endpoint && /^https?:\/\//.test(endpoint) ? ` ${new URL(endpoint).origin}` : "";
})();

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src 'self'${METRICS_DEBUG_ORIGIN}`,
  "frame-src https://calendly.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  basePath: "/nexus",
  poweredByHeader: false,
  images: { unoptimized: true },
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
