import { NextResponse } from "next/server";
import { withAuth, signOut } from "@workos-inc/authkit-nextjs";
import { isAllowedDomain } from "@/lib/auth";

export async function GET(request: Request) {
  const { user } = await withAuth();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!isAllowedDomain(user.email)) {
    console.warn("[auth-callback] rejected non-allowed domain", { email: user.email });
    await signOut({ returnTo: "/login?error=unauthorized" });
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }

  return NextResponse.redirect(new URL("/", request.url));
}
