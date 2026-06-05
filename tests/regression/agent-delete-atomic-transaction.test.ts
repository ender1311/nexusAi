// Regression: agent DELETE ran 6 sequential, non-transactional writes — it cleared
// user locks FIRST, then deleted the agent and its non-cascading orphan rows
// (PersonaArmStats/UserArmStats/LinUCBArm/FailedBrazeSend/UserAgentAssignment).
// If a later write failed (or the process died mid-sequence), the lock release had
// already committed while the rest had not, leaving inconsistent state + orphaned
// rows that skew fleet-wide stats. The fix wraps every write in prisma.$transaction
// so they commit atomically or roll back together.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { buildRequest } from "../helpers/request";
import { DELETE as deleteAgent } from "@/app/api/agents/[id]/route";

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("DELETE /api/agents/[id] atomicity", () => {
  it("rolls back the lock release when the agent delete fails", async () => {
    // lockedByAgentId has no FK (by design), so a user can be locked by an id that
    // has no Agent row. The DELETE's first statement clears locks for that id; the
    // second (agent.delete) then throws P2025 because the agent does not exist.
    // Under a single transaction, the lock-clearing must roll back with it.
    await prisma.trackedUser.create({
      data: { externalId: "u-locked", lockedByAgentId: "ghost-agent" },
    });

    const req = buildRequest("DELETE");
    const res = await deleteAgent(req as unknown as Parameters<typeof deleteAgent>[0], {
      params: Promise.resolve({ id: "ghost-agent" }),
    });

    // Deleting a non-existent agent fails (P2025 → 404 via handleRouteError).
    expect(res.status).toBe(404);

    // Atomicity guard: because agent.delete threw, the preceding lock-clearing
    // updateMany must have rolled back — the user stays locked. Pre-fix, the
    // sequential updateMany had already committed and the lock would be gone.
    const user = await prisma.trackedUser.findUnique({ where: { externalId: "u-locked" } });
    expect(user?.lockedByAgentId).toBe("ghost-agent");
  });
});
