import { NextResponse } from "next/server";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";

export async function GET() {
  const signInUrl = await getSignInUrl();
  return NextResponse.redirect(signInUrl);
}
