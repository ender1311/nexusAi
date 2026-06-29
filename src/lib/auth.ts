import { withAuth, signOut } from "@workos-inc/authkit-nextjs";
import { NextResponse } from "next/server";
import { isDemoMode, DEMO_USER } from "@/lib/auth/demo";

export { signOut };

const ALLOWED_DOMAINS = ["@youversion.com", "@life.church"] as const;

export function isAllowedDomain(email?: string | null): boolean {
  const lower = email?.toLowerCase();
  return Boolean(lower && ALLOWED_DOMAINS.some((d) => lower.endsWith(d)));
}

export async function getSessionUser() {
  if (isDemoMode()) return { ...DEMO_USER };
  const { user } = await withAuth();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
  };
}

export const COPYWRITER_ROLE = "copywriter";

export type RoleFlags = { isAdmin: boolean; isCopywriter: boolean; canManageLibrary: boolean };

/** Pure mapping from WorkOS role slugs to capability flags. */
export function deriveRoleFlags(roles: string[] | undefined): RoleFlags {
  const isAdmin = roles?.includes("admin") ?? false;
  const isCopywriter = roles?.includes(COPYWRITER_ROLE) ?? false;
  return { isAdmin, isCopywriter, canManageLibrary: isAdmin || isCopywriter };
}

/** Returns session user + role flags in one call. */
export async function getAuth(): Promise<{
  user: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
} & RoleFlags> {
  if (isDemoMode()) {
    return { user: { ...DEMO_USER }, ...deriveRoleFlags([]) };
  }
  const auth = await withAuth();
  const user = auth.user
    ? {
        id: auth.user.id,
        email: auth.user.email,
        firstName: auth.user.firstName ?? null,
        lastName: auth.user.lastName ?? null,
      }
    : null;
  return { user, ...deriveRoleFlags(auth.roles) };
}

/** Returns a 403 Forbidden response if the current user is not an admin, or null if they are. */
export async function requireAdmin(): Promise<NextResponse<{ error: string }> | null> {
  const { isAdmin } = await getAuth();
  if (!isAdmin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

/** 403 unless the caller is an admin OR a copywriter. */
export async function requireLibraryEditor(): Promise<NextResponse<{ error: string }> | null> {
  const { canManageLibrary } = await getAuth();
  if (!canManageLibrary) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
