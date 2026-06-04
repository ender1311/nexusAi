// Hosts we recognize and trust to initiate/complete WorkOS auth flows. WorkOS
// must have the matching /callback and /login redirect URIs registered for each.
const ALLOWED_HOSTS = new Set(["nexus.youversion.com", "nexus-ai-yv.vercel.app"]);

function isLocalhost(host: string): boolean {
  return host.startsWith("localhost") || host.startsWith("127.0.0.1");
}

export function isKnownAuthHost(host: string | null | undefined): boolean {
  const h = host ?? "";
  return ALLOWED_HOSTS.has(h) || isLocalhost(h);
}

// Resolve the absolute origin (scheme + host) for an auth redirect URL. Prefers
// the request's own host for known/local hosts so auth works across both
// production domains and local dev; otherwise falls back to the origin of
// `fallbackUrl` (e.g. WORKOS_REDIRECT_URI) for unknown preview hosts.
//
// The result is always absolute: WorkOS validates the logout `return_to`
// against its absolute redirect-URI allowlist, and a relative path fails.
export function resolveAuthOrigin(
  host: string | null | undefined,
  fallbackUrl?: string,
): string {
  const h = host ?? "";
  if (isKnownAuthHost(h)) {
    return `${isLocalhost(h) ? "http" : "https"}://${h}`;
  }
  if (fallbackUrl) {
    return new URL(fallbackUrl).origin;
  }
  return `https://${h}`;
}
