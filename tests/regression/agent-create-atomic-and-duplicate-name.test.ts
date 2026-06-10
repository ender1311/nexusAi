// Regression for 2026-06-09 audit finding A3: POST /agents (Hono API service)
// created the agent first and attached persona targets in a separate write —
// a persona-target failure left a half-configured agent behind. It also had
// no duplicate-name guard, so a client retry after the app-proxy timeout
// created a second identical agent.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll, prisma } from "../helpers/db";
import { createAgent, createPersona } from "../helpers/builders";
import { app } from "../../apps/api/src/app";

const AUTH = { Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? "test-secret"}` };
const ADMIN = { ...AUTH, "X-User-Role": "admin", "Content-Type": "application/json" };

const basePayload = {
  algorithm: "thompson",
  epsilon: 0.1,
  funnelStage: "wau",
  goals: [],
  messages: [],
};

function postAgent(payload: Record<string, unknown>) {
  return app.request("/agents", {
    method: "POST",
    headers: ADMIN,
    body: JSON.stringify(payload),
  });
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("POST /agents — atomic create + duplicate-name guard (A3)", () => {
  it("rolls back the agent when persona-target creation fails", async () => {
    const res = await postAgent({
      ...basePayload,
      name: "A3 Rollback Agent",
      targetPersonaIds: ["persona_does_not_exist"],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);

    const agents = await prisma.agent.findMany({ where: { name: "A3 Rollback Agent" } });
    expect(agents.length).toBe(0);
  });

  it("commits agent and persona targets together when valid", async () => {
    const persona = await createPersona();
    const res = await postAgent({
      ...basePayload,
      name: "A3 Valid Agent",
      targetPersonaIds: [persona.id],
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string };

    const targets = await prisma.agentPersonaTarget.findMany({ where: { agentId: body.id } });
    expect(targets.length).toBe(1);
    expect(targets[0]!.personaId).toBe(persona.id);
  });

  it("returns 409 instead of creating a duplicate agent on retry", async () => {
    await createAgent({ name: "A3 Dupe Agent" });

    const res = await postAgent({ ...basePayload, name: "A3 Dupe Agent" });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toContain("already exists");

    const agents = await prisma.agent.findMany({ where: { name: "A3 Dupe Agent" } });
    expect(agents.length).toBe(1);
  });

  it("treats the name as trimmed for the duplicate check", async () => {
    await createAgent({ name: "A3 Trim Agent" });

    const res = await postAgent({ ...basePayload, name: "  A3 Trim Agent  " });
    expect(res.status).toBe(409);
  });
});
