import { NextRequest, NextResponse } from "next/server";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { isKnownAuthHost, resolveAuthOrigin } from "@/lib/auth-origin";

export async function GET(request: NextRequest) {
  const host = request.headers.get("host");

  // Use the request's own host for the callback so auth works on both domains.
  // Fall back to the env var for unknown hosts (preview deployments, etc.).
  const redirectUri = isKnownAuthHost(host)
    ? `${resolveAuthOrigin(host)}/callback`
    : process.env.WORKOS_REDIRECT_URI;

  const signInUrl = await getSignInUrl({ redirectUri });
  return NextResponse.redirect(signInUrl);
}
