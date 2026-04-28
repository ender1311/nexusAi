import { handleAuth } from "@workos-inc/authkit-nextjs";

/**
 * WorkOS AuthKit OAuth callback.
 * Exchanges the authorization code for a session cookie and redirects to the
 * originally requested path (or "/" if none recorded).
 */
export const GET = handleAuth();
