import { config } from "dotenv";

// Match Next.js / Bun: `.env` then `.env.local` overrides, so `migrate deploy` targets the same DB as dev and tests.
config();
config({ path: ".env.local", override: true });

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
