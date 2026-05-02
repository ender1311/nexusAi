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
