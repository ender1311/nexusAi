import { publicConfig } from "@site/lib/public-config";

export const config = {
  ...publicConfig,
  leadNotifyEmail: process.env.LEAD_NOTIFY_EMAIL ?? "danluk1311@gmail.com",
  leadFromEmail: "Nexus <nexus@beaconfrontier.com>",
};

/**
 * The salt for hashing lead IPs. Production must set LEAD_IP_SALT; there it
 * returns null when the salt is missing (misconfigured). Elsewhere it falls
 * back to a fixed dev salt.
 */
export function resolveIpSalt(env: Record<string, string | undefined>): string | null {
  if (env.LEAD_IP_SALT) return env.LEAD_IP_SALT;
  if (env.VERCEL_ENV === "production") return null;
  return "nexus-dev-salt";
}
