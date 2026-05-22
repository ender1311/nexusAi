import { NextRequest, NextResponse } from "next/server";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";

// Allowed hosts that may initiate auth — WorkOS must have all these /callback URIs registered.
const ALLOWED_HOSTS = new Set([
  "nexus.youversion.com",
  "nexus-ai-yv.vercel.app",
]);

export async function GET(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const isLocalhost = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const proto = isLocalhost ? "http" : "https";

  // Use the request's own host for the callback so auth works on both domains.
  // Fall back to the env var for unknown hosts (preview deployments, etc.).
  const redirectUri =
    ALLOWED_HOSTS.has(host) || isLocalhost
      ? `${proto}://${host}/callback`
      : process.env.WORKOS_REDIRECT_URI;

  const signInUrl = await getSignInUrl({ redirectUri });
  return NextResponse.redirect(signInUrl);
}
