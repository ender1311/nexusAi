// REGRESSION (audit 2026-10-13, spec §2 "LinUCB lost updates"):
// updateLinUCBArm did findUnique → Sherman-Morrison in JS → update with no
// lock or version check. Concurrent rewards for the same arm overwrote each
// other (last writer wins), silently discarding learning. The first-update
// path also upserted an identity arm that could reset a concurrent update.
// Fix: compare-and-swap on LinUCBArm.version with bounded retry.
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { updateLinUCBArm, resetStaleLinUCBArm, LINUCB_MAX_CAS_ATTEMPTS } from "@/lib/arm-stats";
import { decideForUser } from "@/lib/decide";
import { createAgent, createMessage, createPersona, createUser, createVariant } from "../helpers/builders";
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
  it.each([8, 12])("%d concurrent updates on a NEW arm all land and match the sequential result", async (n) => {
    const xs = contexts(n);
    await Promise.all(xs.map((contextVec) =>
      updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec, reward: 1 }),
    ));
    const arm = await readArm();
    const want = sequential(xs, 1);
    expect(arm.tries).toBe(n);
    expect(arm.version).toBe(n);
    want.b.forEach((v, i) => expect(arm.b[i]).toBeCloseTo(v, 6));
    want.aInv.forEach((v, i) => expect(arm.aInv[i]).toBeCloseTo(v, 6));
  });

  it("decideForUser's stale-dimension reset bumps version and leaves an identity-sized arm", async () => {
    await createPersona({ name: "default", isActive: true });
    const agent = await createAgent({ algorithm: "linucb" });
    const message = await createMessage(agent.id);
    const variant = await createVariant(message.id);
    await createUser("usr_stale_reset");
    await prisma.linUCBArm.create({
      data: { agentId: agent.id, variantId: variant.id, aInv: [1, 0, 0, 1], b: [0, 0], tries: 3 },
    });

    const result = await decideForUser({ agentId: agent.id, externalUserId: "usr_stale_reset", skipSchedulingChecks: true });
    expect(result).not.toBeNull();

    const arm = await prisma.linUCBArm.findUniqueOrThrow({
      where: { agentId_variantId: { agentId: agent.id, variantId: variant.id } },
    });
    expect(arm.version).toBe(1);
    expect(arm.tries).toBe(0);
    expect((arm.aInv as number[]).length).toBe(FEATURE_DIM * FEATURE_DIM);
    expect((arm.b as number[]).length).toBe(FEATURE_DIM);
  });

  it("a stale-dimension reset that loses the CAS keeps the concurrent write instead of resetting over it", async () => {
    // Reader saw the stale row at version 0; a concurrent updateLinUCBArm then
    // replaced it with a learned, current-dimension arm at version 1.
    await prisma.linUCBArm.create({
      data: { agentId: "agent-1", variantId: "variant-1", aInv: [1, 0, 0, 1], b: [0, 0], tries: 3 },
    });
    await updateLinUCBArm({ agentId: "agent-1", variantId: "variant-1", contextVec: contexts(1)[0], reward: 1 });
    const concurrent = await readArm();
    expect(concurrent.version).toBe(1);

    const used = await resetStaleLinUCBArm({ agentId: "agent-1", variantId: "variant-1", version: 0 });

    expect(used).toEqual({ aInv: concurrent.aInv, b: concurrent.b });
    expect(await readArm()).toEqual(concurrent);
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
    const originalDescriptor = Object.getOwnPropertyDescriptor(prisma, "linUCBArm");
    const real = prisma.linUCBArm;
    let casAttempts = 0;
    let warnCalls = 0;
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
      // The client is a Proxy, so a pre-existing own descriptor reports value: undefined;
      // restore the real delegate rather than that descriptor. Delete only if none existed.
      if (originalDescriptor) {
        Object.defineProperty(prisma, "linUCBArm", { ...originalDescriptor, value: real });
      } else {
        delete (prisma as unknown as Record<string, unknown>).linUCBArm;
      }
      warnCalls = warn.mock.calls.length;
      warn.mockRestore();
    }

    expect(casAttempts).toBe(LINUCB_MAX_CAS_ATTEMPTS);
    expect(warnCalls).toBeGreaterThan(0);
    const after = await readArm();
    expect(after.aInv).toEqual(before.aInv);
    expect(after.b).toEqual(before.b);
    expect(after.tries).toBe(before.tries);
    expect(after.version).toBe(before.version + LINUCB_MAX_CAS_ATTEMPTS);
  });
});
