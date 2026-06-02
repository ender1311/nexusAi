// Neon REST helper for branch-per-worker test isolation (Tier 2).
//
// Each parallel test worker gets its own ephemeral Neon branch — an instant
// copy-on-write clone of the test project's default branch (schema + seed data,
// no migration step). Per-branch endpoints give each worker an isolated compute
// + connection budget, which removes the shared-DB truncate race entirely.
//
// SAFETY: this only ever touches the TEST Neon project, identified by
// NEON_TEST_PROJECT_ID (resolved from .env.test, NOT the ambient NEON_PROJECT_ID
// which under .env.local points at PRODUCTION). The parent branch is resolved
// dynamically as the test project's default branch, so nothing here can clone or
// mutate production data.

const NEON_API = "https://console.neon.tech/api/v2";

export type Branch = {
  branchId: string;
  endpointId: string;
  connectionString: string; // includes role + password; never log this
};

type NeonError = { message?: string; code?: string };

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function neonFetch(
  apiKey: string,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${NEON_API}${path}`, {
    ...init,
    headers: { ...authHeaders(apiKey), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    const msg = (body as NeonError)?.message ?? `HTTP ${res.status}`;
    throw new Error(`Neon API ${init?.method ?? "GET"} ${path} failed: ${msg}`);
  }
  return body;
}

/**
 * Resolve the parent branch to clone by matching the TEST DB's endpoint host.
 *
 * SAFETY: this is the guardrail against ever branching production. We do NOT
 * trust a stored "default branch" — we require that the resolved test project
 * actually owns an endpoint whose host equals the host in the test DATABASE_URL.
 * The branch that owns that endpoint is exactly where the test schema+data live,
 * so cloning it is provably the test DB. If no endpoint matches, we abort rather
 * than risk cloning the wrong project.
 */
export async function resolveParentBranchByHost(
  apiKey: string,
  projectId: string,
  expectedHost: string,
): Promise<string> {
  const body = (await neonFetch(apiKey, `/projects/${projectId}/endpoints`)) as {
    endpoints?: Array<{ id: string; host?: string; branch_id?: string }>;
  };
  const endpoints = body.endpoints ?? [];
  // Test DATABASE_URL may use the "-pooler" host variant; Neon reports the plain
  // endpoint host. Normalize both to the endpoint id portion before comparing.
  const norm = (h: string) => h.replace("-pooler.", ".");
  const want = norm(expectedHost);
  const match = endpoints.find(
    (e) => e.host && norm(e.host) === want && e.branch_id,
  );
  if (!match?.branch_id) {
    throw new Error(
      `SAFETY ABORT: Neon project ${projectId} owns no endpoint matching the ` +
        `test DB host "${expectedHost}". Refusing to branch — the resolved ` +
        `project may not be the test project.`,
    );
  }
  return match.branch_id;
}

/**
 * Create an ephemeral branch with its own read_write endpoint and return a
 * ready-to-use pooled connection string. Caller MUST deleteBranch() in a finally.
 */
export async function createBranch(
  apiKey: string,
  projectId: string,
  parentBranchId: string,
  name: string,
): Promise<Branch> {
  const body = (await neonFetch(apiKey, `/projects/${projectId}/branches`, {
    method: "POST",
    body: JSON.stringify({
      branch: { parent_id: parentBranchId, name },
      endpoints: [{ type: "read_write" }],
    }),
  })) as {
    branch: { id: string };
    endpoints: Array<{ id: string }>;
    connection_uris?: Array<{ connection_uri: string }>;
  };

  const branchId = body.branch.id;
  const endpointId = body.endpoints?.[0]?.id;
  const connectionString = body.connection_uris?.[0]?.connection_uri;

  if (!endpointId || !connectionString) {
    // Best-effort cleanup so a partial create doesn't leak a paid branch.
    await deleteBranch(apiKey, projectId, branchId).catch(() => {});
    throw new Error(
      `Neon branch ${branchId} created without an endpoint/connection_uri`,
    );
  }

  return { branchId, endpointId, connectionString };
}

/** Delete a branch (and its endpoints). Idempotent enough for finally blocks. */
export async function deleteBranch(
  apiKey: string,
  projectId: string,
  branchId: string,
): Promise<void> {
  await neonFetch(apiKey, `/projects/${projectId}/branches/${branchId}`, {
    method: "DELETE",
  });
}

/** List branch ids whose names start with the given prefix (for leak cleanup). */
export async function listBranchesByPrefix(
  apiKey: string,
  projectId: string,
  prefix: string,
): Promise<Array<{ id: string; name: string; createdAt: number }>> {
  const body = (await neonFetch(apiKey, `/projects/${projectId}/branches`)) as {
    branches?: Array<{ id: string; name?: string; created_at?: string }>;
  };
  return (body.branches ?? [])
    .filter((b) => (b.name ?? "").startsWith(prefix))
    .map((b) => ({
      id: b.id,
      name: b.name ?? "",
      createdAt: b.created_at ? Date.parse(b.created_at) : 0,
    }));
}
