import { NextResponse } from "next/server";
import { withAuth, signOut } from "@workos-inc/authkit-nextjs";
import { isAllowedDomain } from "@/lib/auth";
import { resolveAuthOrigin } from "@/lib/auth-origin";

export async function GET(request: Request) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!isAllowedDomain(user.email)) {
    console.warn("[auth-callback] rejected non-allowed domain", { email: user.email });
    const origin = resolveAuthOrigin(request.headers.get("host"), process.env.WORKOS_REDIRECT_URI);
    await signOut({ returnTo: `${origin}/login?error=unauthorized` });
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }

  return NextResponse.redirect(new URL("/", request.url));
}
