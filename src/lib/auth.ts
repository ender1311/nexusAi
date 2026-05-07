import { withAuth, signOut } from "@workos-inc/authkit-nextjs";

export { signOut };

const ALLOWED_DOMAINS = ["@youversion.com", "@life.church"] as const;

export function isAllowedDomain(email?: string | null): boolean {
  const lower = email?.toLowerCase();
  return Boolean(lower && ALLOWED_DOMAINS.some((d) => lower.endsWith(d)));
}

export async function getSessionUser() {
  const { user } = await withAuth();
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
  };
}

/** Returns session user + admin flag in one call. */
export async function getAuth(): Promise<{
  user: { id: string; email: string; firstName: string | null; lastName: string | null } | null;
  isAdmin: boolean;
}> {
  const auth = await withAuth();
  const user = auth.user
    ? {
        id: auth.user.id,
        email: auth.user.email,
        firstName: auth.user.firstName ?? null,
        lastName: auth.user.lastName ?? null,
      }
    : null;
  return { user, isAdmin: auth.roles?.includes("admin") ?? false };
}
