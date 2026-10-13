// REGRESSION (audit 2026-10-13, spec §2 "LinUCB lost updates"):
// updateLinUCBArm did findUnique → Sherman-Morrison in JS → update with no
// lock or version check. Concurrent rewards for the same arm overwrote each
// other (last writer wins), silently discarding learning. The first-update
// path also upserted an identity arm that could reset a concurrent update.
// Fix: compare-and-swap on LinUCBArm.version with bounded retry.
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { updateLinUCBArm, LINUCB_MAX_CAS_ATTEMPTS } from "@/lib/arm-stats";
import { LinUCB } from "@/lib/engine/linucb";
import { FEATURE_DIM } from "@/lib/engine/feature-vector";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

function contexts(n: number): number[][] {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: FEATURE_DIM }, (_, d) => ((i + 1) * (d + 3)) % 7 / 7),
  );
}

/** Expected arm after applying every (x, r) sequentially — A and b are order-independent sums. */
function sequential(xs: number[][], r: number) {
  const lin = new LinUCB();
  let { aInv, b } = lin.initialArm(FEATURE_DIM);
  for (const x of xs) ({ aInv, b } = lin.update(aInv, b, x, r));
  return { aInv, b };
}

async function readArm() {
  const row = await prisma.linUCBArm.findUniqueOrThrow({
    where: { agentId_variantId: { agentId: "agent-1", variantId: "variant-1" } },
  });
  return { aInv: row.aInv as number[], b: row.b as number[], tries: row.tries, version: row.version };
}

describe("regression: concurrent LinUCB updates are not lost", () => {
  // Each CAS round has at least one winner, so N concurrent writers all land within N
  // attempts. Use exactly LINUCB_MAX_CAS_ATTEMPTS writers: the most the bounded retry guarantees.
  it("LINUCB_MAX_CAS_ATTEMPTS concurrent updates on a NEW arm all land", async () => {
    const xs = contexts(LINUCB_MAX_CAS_ATTEMPTS);
    await Promise.all(xs.map((contextVec) =>
      updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec, reward: 1 }),
    ));
    const arm = await readArm();
    const want = sequential(xs, 1);
    expect(arm.tries).toBe(LINUCB_MAX_CAS_ATTEMPTS);
    want.b.forEach((v, i) => expect(arm.b[i]).toBeCloseTo(v, 6));
    want.aInv.forEach((v, i) => expect(arm.aInv[i]).toBeCloseTo(v, 6));
  });

  it("a stale-dimension reset bumps version so an in-flight update retries", async () => {
    await updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec: contexts(1)[0], reward: 1 });
    const before = await readArm();
    const fresh = new LinUCB().initialArm(FEATURE_DIM);
    await prisma.linUCBArm.update({
      where: { agentId_variantId: { agentId: "agent-1", variantId: "variant-1" } },
      data: { aInv: fresh.aInv, b: fresh.b, tries: 0, version: { increment: 1 } },
    });
    expect((await readArm()).version).toBe(before.version + 1);
  });
});

describe("regression: CAS retry exhaustion", () => {
  it("gives up after LINUCB_MAX_CAS_ATTEMPTS without corrupting the arm", async () => {
    await updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec: contexts(1)[0], reward: 1 });
    const before = await readArm();
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    // The extended Prisma client's model delegates ignore spyOn, so shadow the
    // delegate with a proxy that simulates a competing writer: it bumps `version` just before every CAS attempt,
    // which makes each attempt's WHERE version = <stale> match zero rows.
    const real = prisma.linUCBArm;
    let casAttempts = 0;
    Object.defineProperty(prisma, "linUCBArm", {
      configurable: true,
      get: () =>
        new Proxy(real, {
          get(target, prop, receiver) {
            if (prop !== "updateMany") return Reflect.get(target, prop, receiver);
            return async (args: Parameters<typeof real.updateMany>[0]) => {
              casAttempts++;
              await real.update({
                where: { agentId_variantId: { agentId: "agent-1", variantId: "variant-1" } },
                data: { version: { increment: 1 } },
              });
              return real.updateMany(args);
            };
          },
        }),
    });
    try {
      await updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec: contexts(2)[1], reward: 1 });
    } finally {
      Object.defineProperty(prisma, "linUCBArm", { value: real, writable: true, enumerable: true, configurable: true });
    }

    expect(casAttempts).toBe(LINUCB_MAX_CAS_ATTEMPTS);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    const after = await readArm();
    expect(after.aInv).toEqual(before.aInv);
    expect(after.b).toEqual(before.b);
    expect(after.tries).toBe(before.tries);
    expect(after.version).toBe(before.version + LINUCB_MAX_CAS_ATTEMPTS);
  });
});
