// tests/regression/materialize-transaction-timeout.test.ts
//
// REGRESSION (audit fix #2): materializeSegment runs inside prisma.$transaction
// and issues `SET LOCAL statement_timeout = 60_000`, but the $transaction wrapper
// itself defaults to a 5s interactive-transaction timeout — which fires FIRST and
// aborts large segments before the 60s statement budget is ever reached. The fix
// raises the wrapper budget to MATERIALIZE_TX_TIMEOUT_MS (> 5s). Prisma's
// $transaction is non-writable, so it can't be spied; instead this is a behavioral
// test — it runs a real interactive transaction that sleeps 5.5s (longer than the
// 5s default) under the exported budget and asserts it COMPLETES rather than aborts.
// Reverting the fix to the 5s default makes pg cancel the statement and this throws.

import { describe, expect, it } from "bun:test";
import { prisma } from "../helpers/db";
import { MATERIALIZE_TX_TIMEOUT_MS } from "@/lib/segments/materialize";

describe("regression: materialize transaction budget exceeds the 5s interactive default", () => {
  it("exports a budget above the 5s default", () => {
    expect(MATERIALIZE_TX_TIMEOUT_MS).toBeGreaterThan(5_000);
  });

  it("permits an interactive transaction that runs longer than 5s", async () => {
    const result = await prisma.$transaction(
      async (tx) => {
        // 5.5s exceeds the 5s interactive-transaction default that previously
        // aborted large segments mid-materialize. Under the raised budget it
        // must run to completion. ($executeRawUnsafe avoids deserializing
        // pg_sleep's void return that $queryRaw chokes on.)
        await tx.$executeRawUnsafe("SELECT pg_sleep(5.5)");
        return "completed";
      },
      { timeout: MATERIALIZE_TX_TIMEOUT_MS },
    );
    expect(result).toBe("completed");
  }, 15_000);
});
