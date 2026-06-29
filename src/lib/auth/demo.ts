/**
 * Demo mode: when DEMO_MODE=true the app is exposed publicly with no WorkOS
 * login. Every visitor is treated as a single regular (non-admin) signed-in
 * user, so the UI renders fully while admin/library routes still return 403.
 */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export const DEMO_USER = {
  id: "demo-user",
  email: "demo@nexus.app",
  firstName: "Demo",
  lastName: "User",
} as const;
