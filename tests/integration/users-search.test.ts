import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { truncateAll } from "../helpers/db";
import { createUser, createPersona } from "../helpers/builders";

const { GET } = await import("@/app/api/users/search/route");

function req(q: string | null) {
  const url = q === null ? "http://localhost/api/users/search" : `http://localhost/api/users/search?q=${encodeURIComponent(q)}`;
  return new Request(url);
}

beforeEach(async () => { await truncateAll(); });
afterEach(async () => { await truncateAll(); });

describe("GET /api/users/search", () => {
  it("returns 400 when q is empty", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is missing", async () => {
    const res = await GET(req(null));
    expect(res.status).toBe(400);
  });

  it("finds a user by exact externalId", async () => {
    const persona = await createPersona({ name: "Engaged" });
    await createUser("ext-123", { personaId: persona.id, funnelStage: "wau", attributes: { email: "x@y.com", name: "Xy" } });
    const res = await GET(req("ext-123"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ externalId: "ext-123", email: "x@y.com", name: "Xy", funnelStage: "wau", personaName: "Engaged" });
  });

  it("finds a user by exact brazeId", async () => {
    await createUser("ext-9", { brazeId: "braze-abc", attributes: { email: "b@y.com" } });
    const res = await GET(req("braze-abc"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].externalId).toBe("ext-9");
  });

  it("finds a user by exact email (contains @)", async () => {
    await createUser("ext-mail", { attributes: { email: "find@me.com", name: "Finder" } });
    const res = await GET(req("find@me.com"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ externalId: "ext-mail", email: "find@me.com", name: "Finder" });
  });

  // Audit fix #10: the email path selected only attributes->>'name' and returned
  // a null name for users that only have first_name/last_name — the id/brazeId path
  // already composed the name via nameOf(). Both paths must fall back identically.
  it("composes name from first_name/last_name on the email path when name attr is absent", async () => {
    await createUser("ext-fl", { attributes: { email: "fl@me.com", first_name: "Ada", last_name: "Lovelace" } });
    const res = await GET(req("fl@me.com"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ externalId: "ext-fl", email: "fl@me.com", name: "Ada Lovelace" });
  });

  it("returns 200 with [] when nothing matches", async () => {
    const res = await GET(req("nobody-here"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});
