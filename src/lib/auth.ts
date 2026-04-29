import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";

const ALLOWED_DOMAINS = ["youversion.com", "life.church"] as const;

function isAllowedEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return ALLOWED_DOMAINS.some((d) => lower.endsWith(`@${d}`));
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
  plugins: [
    // Mirrors Set-Cookie headers into the Next.js cookie store so
    // session reads/refreshes in RSC and server actions work correctly.
    nextCookies(),
  ],
  account: {
    // Encrypted cookie holds OAuth state/PKCE — avoids DB round-trips and
    // prevents state_mismatch errors under pooled connections.
    storeStateStrategy: "cookie",
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!isAllowedEmail(user.email)) {
            throw new Error(
              "Nexus only accepts @youversion.com and @life.church accounts."
            );
          }
        },
      },
    },
  },
});

export type Auth = typeof auth;
