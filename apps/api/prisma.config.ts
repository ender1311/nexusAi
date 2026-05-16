import { config } from "dotenv";
config();
config({ path: "../../.env.local", override: true });

// Safety guard: block migration commands against production unless CONFIRM_PROD_MIGRATE=true.
// Skipped for `prisma generate` (no DB connection needed).
const isMigrateCommand = process.argv.some((arg) => arg.includes("migrate"));
if (isMigrateCommand) {
  const PROD_ENDPOINT_IDS = ["ep-old-surf-a4p5os6s"];
  const dbUrl = process.env["DATABASE_URL"] ?? "";
  const prodMatch = PROD_ENDPOINT_IDS.find((id) => dbUrl.includes(id));
  if (prodMatch && !process.env["CONFIRM_PROD_MIGRATE"]) {
    console.error(
      "\n🚨  MIGRATION SAFETY ABORT\n" +
      `    DATABASE_URL targets production endpoint "${prodMatch}".\n` +
      "    Set CONFIRM_PROD_MIGRATE=true to proceed:\n\n" +
      "    CONFIRM_PROD_MIGRATE=true npx prisma migrate deploy\n",
    );
    process.exit(1);
  }
}

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "../../prisma/schema.prisma",
  migrations: { path: "../../prisma/migrations" },
  datasource: { url: process.env["DATABASE_URL"] },
});
