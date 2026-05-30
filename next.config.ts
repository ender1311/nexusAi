import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  // Prevent cross-origin data leaks
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  // CSP: restrict resource loading to prevent XSS escalation.
  // 'unsafe-inline' on styles is required for Tailwind v4 runtime.
  // 'unsafe-eval' is omitted — Next.js App Router does not require it in production.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js ships inline <script> tags for hydration; nonce-based CSP would
      // require middleware changes — 'unsafe-inline' is acceptable here because
      // all HTML is server-rendered and sanitized by React's JSX escaping.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      // WorkOS auth callbacks + Braze REST API calls happen server-side only,
      // but allow 'self' for client-side fetch to our own API routes.
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-src https://www.youtube-nocookie.com",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts"],
    // Next 16 spawns build workers = CPU count; on memory-constrained CI runners
    // that OOMs. Cap worker count so the build stays within the runner's memory.
    cpus: 4,
  },
  headers: async () => [
    { source: "/(.*)", headers: securityHeaders },
    {
      source: "/(.*)\\.mp4",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
    {
      source: "/(.*)\\.png",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
    {
      source: "/(.*)\\.svg",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
    {
      source: "/(.*)\\.ico",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
    {
      source: "/(.*)\\.webmanifest",
      headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
    },
  ],
};

export default nextConfig;
