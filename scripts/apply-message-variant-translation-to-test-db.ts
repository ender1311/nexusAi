// One-off: apply MessageVariantTranslation + Agent.localizePush to the TEST database only.
//
// prisma migrate/db push target .env.local (production) in this repo, so the test
// DB schema is maintained out-of-band. This reads the connection string straight
// from .env.test, hard-refuses the known production endpoint, and runs the same
// idempotent DDL as the committed migration. Safe to run repeatedly.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const PROD_ENDPOINT = "ep-old-surf-a4p5os6s";
const TEST_ENDPOINT = "ep-cold-dawn-anok51q1";

function readEnvTest(key: string): string | undefined {
  const text = readFileSync(new URL("../.env.test", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

const url = readEnvTest("DATABASE_URL_UNPOOLED") ?? readEnvTest("DATABASE_URL");
if (!url) throw new Error("No DATABASE_URL(_UNPOOLED) found in .env.test");
if (url.includes(PROD_ENDPOINT)) throw new Error(`SAFETY ABORT: .env.test points at production endpoint ${PROD_ENDPOINT}`);
if (!url.includes(TEST_ENDPOINT)) throw new Error(`SAFETY ABORT: expected test endpoint ${TEST_ENDPOINT}, refusing unknown DB`);

const sql = neon(url);

await sql`ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "localizePush" BOOLEAN NOT NULL DEFAULT false`;

await sql`
  CREATE TABLE IF NOT EXISTS "MessageVariantTranslation" (
    "id" TEXT NOT NULL,
    "messageVariantId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "bodyPersonal" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT,
    "sourceFile" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageVariantTranslation_pkey" PRIMARY KEY ("id")
  )
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS "MessageVariantTranslation_messageVariantId_language_key" ON "MessageVariantTranslation"("messageVariantId", "language")`;
await sql`CREATE INDEX IF NOT EXISTS "MessageVariantTranslation_messageVariantId_status_idx" ON "MessageVariantTranslation"("messageVariantId", "status")`;
await sql`ALTER TABLE "MessageVariantTranslation" DROP CONSTRAINT IF EXISTS "MessageVariantTranslation_messageVariantId_fkey"`;
await sql`ALTER TABLE "MessageVariantTranslation" ADD CONSTRAINT "MessageVariantTranslation_messageVariantId_fkey" FOREIGN KEY ("messageVariantId") REFERENCES "MessageVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE`;

const rows = await sql`SELECT to_regclass('public."MessageVariantTranslation"') AS tbl`;
console.log("MessageVariantTranslation present on test DB:", rows[0]?.tbl);
const col = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'Agent' AND column_name = 'localizePush'`;
console.log("Agent.localizePush present on test DB:", col.length === 1);
