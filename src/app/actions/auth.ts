"use server";

import { headers } from "next/headers";
import { signOut } from "@workos-inc/authkit-nextjs";
import { resolveAuthOrigin } from "@/lib/auth-origin";

export async function handleSignOut() {
  // WorkOS validates the logout `return_to` against its absolute redirect-URI
  // allowlist; a relative path renders WorkOS's hosted error page instead of
  // landing the user back on /login. Build an absolute URL from the request host.
  const origin = resolveAuthOrigin((await headers()).get("host"), process.env.WORKOS_REDIRECT_URI);
  await signOut({ returnTo: `${origin}/login` });
}
