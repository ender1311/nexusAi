import { afterEach, describe, expect, it } from "bun:test";
import {
  resolveParentBranchByHost,
  createBranch,
  deleteBranch,
  listBranchesByPrefix,
} from "../../scripts/lib/neon-branch";

// Mock the global fetch the helper uses. Each test installs a handler that maps
// (method, path) -> { status, body }. Restores the real fetch afterward.
const realFetch = globalThis.fetch;

type Handler = (
  method: string,
  url: string,
  body: unknown,
) => { status: number; json: unknown };

function mockFetch(handler: Handler): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const { status, json } = handler(method, url, body);
    return new Response(JSON.stringify(json), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const KEY = "napi_test";
const PID = "proj-test";

describe("resolveParentBranchByHost", () => {
  it("returns the branch id of the endpoint matching the test host", async () => {
    mockFetch(() => ({
      status: 200,
      json: {
        endpoints: [
          { id: "ep-a", host: "ep-a.region.neon.tech", branch_id: "br-a" },
          { id: "ep-b", host: "ep-b.region.neon.tech", branch_id: "br-b" },
        ],
      },
    }));
    const got = await resolveParentBranchByHost(KEY, PID, "ep-b.region.neon.tech");
    expect(got).toBe("br-b");
  });

  it("matches the -pooler host variant against the plain endpoint host", async () => {
    mockFetch(() => ({
      status: 200,
      json: {
        endpoints: [
          { id: "ep-x", host: "ep-x.region.neon.tech", branch_id: "br-x" },
        ],
      },
    }));
    const got = await resolveParentBranchByHost(
      KEY,
      PID,
      "ep-x-pooler.region.neon.tech",
    );
    expect(got).toBe("br-x");
  });

  it("ABORTS (throws) when no endpoint matches the test host — the prod guard", async () => {
    mockFetch(() => ({
      status: 200,
      json: {
        endpoints: [
          { id: "ep-prod", host: "ep-prod.region.neon.tech", branch_id: "br-prod" },
        ],
      },
    }));
    await expect(
      resolveParentBranchByHost(KEY, PID, "ep-test.region.neon.tech"),
    ).rejects.toThrow(/SAFETY ABORT/);
  });
});

describe("createBranch", () => {
  it("returns branchId, endpointId, and connection string on success", async () => {
    mockFetch((method, url) => {
      expect(method).toBe("POST");
      expect(url).toContain(`/projects/${PID}/branches`);
      return {
        status: 201,
        json: {
          branch: { id: "br-new" },
          endpoints: [{ id: "ep-new" }],
          connection_uris: [{ connection_uri: "postgresql://u:p@ep-new/db" }],
        },
      };
    });
    const br = await createBranch(KEY, PID, "br-parent", "ci-w0-abc");
    expect(br.branchId).toBe("br-new");
    expect(br.endpointId).toBe("ep-new");
    expect(br.connectionString).toBe("postgresql://u:p@ep-new/db");
  });

  it("cleans up and throws if the response has no endpoint/connection_uri", async () => {
    const calls: string[] = [];
    mockFetch((method, url) => {
      calls.push(`${method} ${url}`);
      if (method === "POST") {
        return { status: 201, json: { branch: { id: "br-partial" }, endpoints: [] } };
      }
      return { status: 200, json: {} }; // DELETE cleanup
    });
    await expect(
      createBranch(KEY, PID, "br-parent", "ci-w0-abc"),
    ).rejects.toThrow(/without an endpoint/);
    // Best-effort cleanup deletes the partial branch.
    expect(calls.some((c) => c.startsWith("DELETE") && c.includes("br-partial"))).toBe(true);
  });
});

describe("deleteBranch", () => {
  it("issues a DELETE to the branch path", async () => {
    let seen = "";
    mockFetch((method, url) => {
      seen = `${method} ${url}`;
      return { status: 200, json: {} };
    });
    await deleteBranch(KEY, PID, "br-gone");
    expect(seen).toBe(`DELETE https://console.neon.tech/api/v2/projects/${PID}/branches/br-gone`);
  });

  it("throws on a non-OK response so finally blocks can swallow if desired", async () => {
    mockFetch(() => ({ status: 404, json: { message: "not found" } }));
    await expect(deleteBranch(KEY, PID, "br-missing")).rejects.toThrow(/not found/);
  });
});

describe("listBranchesByPrefix", () => {
  it("returns only branches whose name starts with the prefix, with parsed timestamps", async () => {
    mockFetch(() => ({
      status: 200,
      json: {
        branches: [
          { id: "br-1", name: "ci-w0-old", created_at: "2026-01-01T00:00:00Z" },
          { id: "br-2", name: "main", created_at: "2026-01-01T00:00:00Z" },
          { id: "br-3", name: "ci-w1-new", created_at: "2026-06-01T00:00:00Z" },
        ],
      },
    }));
    const got = await listBranchesByPrefix(KEY, PID, "ci-");
    expect(got.map((b) => b.id).sort()).toEqual(["br-1", "br-3"]);
    expect(got.find((b) => b.id === "br-3")!.createdAt).toBe(
      Date.parse("2026-06-01T00:00:00Z"),
    );
  });
});
