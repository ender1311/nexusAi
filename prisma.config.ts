import { config } from "dotenv";

// Match Next.js / Bun: `.env` then `.env.local` overrides, so `migrate deploy` targets the same DB as dev and tests.
config();
config({ path: ".env.local", override: true });

import { defineConfig } from "prisma/config";
import { LIVE_DB_OVERRIDE_ENV, shouldBlockPrismaCommand } from "./src/lib/db-safety";

// SAFETY: .env.local points at a live (Neon) DB, so `prisma migrate dev`,
// `migrate reset`, `db push` and `db execute` would rewrite or wipe it. Refuse
// those against any non-local URL unless explicitly overridden. generate,
// migrate deploy/status and studio stay allowed.
if (shouldBlockPrismaCommand(process.argv, process.env["DATABASE_URL"], process.env)) {
  throw new Error(
    `SAFETY ABORT (prisma CLI): refusing to run a schema-changing/destructive command ` +
      `(migrate dev, migrate reset, db push, db execute) against a non-local database. ` +
      `Use \`prisma migrate deploy\` for live DBs. If you really mean to change a live ` +
      `DB's schema this way, re-run with ${LIVE_DB_OVERRIDE_ENV}=1.`,
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
