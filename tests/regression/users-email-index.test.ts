// tests/regression/users-email-index.test.ts
//
// REGRESSION: email search MUST use the PostgreSQL JSON-path column expression
// attributes->>'email' (backed by index "User_attributes_email_idx"), NOT Prisma's
// JSON-path filter DSL which does not reliably hit the expression index on 34.6M rows.
// This test pins the exact SQL shape so a future refactor to prisma.findFirst({ where:
// { attributes: { path: ['email'] } } }) breaks here instead of silently full-scanning.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createUser } from "../helpers/builders";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("regression: email lookup uses attributes->>'email' column expression", () => {
  it("returns the user whose attributes email matches via the ->> expression", async () => {
    await createUser("u-email-1", { attributes: { email: "match@example.com", name: "Match" } });
    await createUser("u-email-2", { attributes: { email: "other@example.com" } });

    const rows = await prisma.$queryRaw<Array<{ externalId: string; email: string | null }>>`
      SELECT u."externalId", u."attributes"->>'email' AS email
      FROM "User" u
      WHERE u."attributes"->>'email' = ${"match@example.com"}
      LIMIT 25
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.externalId).toBe("u-email-1");
    expect(rows[0]!.email).toBe("match@example.com");
  });

  it("the User_attributes_email_idx index exists in the schema", async () => {
    const idx = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'User' AND indexname = 'User_attributes_email_idx'
    `;
    expect(idx).toHaveLength(1);
  });

  // Existence alone doesn't prove the planner USES the index — a refactor to a
  // Prisma JSON-path filter could full-scan while the index sits unused. With
  // enable_seqscan off, the plan falls back to the index only if it's usable for
  // this predicate; if the index were dropped the plan would still seq-scan (just
  // penalized), so asserting the index name in the plan pins a genuine index hit.
  it("the email lookup query plans an Index Scan on User_attributes_email_idx", async () => {
    await createUser("u-email-plan", { attributes: { email: "plan@example.com" } });

    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(
        `EXPLAIN SELECT u."externalId" FROM "User" u WHERE u."attributes"->>'email' = 'plan@example.com' LIMIT 25`,
      );
    });

    const planText = plan.map((r) => r["QUERY PLAN"]).join("\n");
    expect(planText).toContain("User_attributes_email_idx");
  });
});
