/**
 * Build a NextRequest-compatible Request for route handler tests.
 * Route handlers only use req.headers.get() and req.json(), so a plain
 * Request cast works without importing from next/server.
 */
export function buildRequest(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  headers: Record<string, string> = {}
): Request {
  return new Request("http://localhost/", {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

export function withAuth(headers: Record<string, string>, token: string): Record<string, string> {
  return { ...headers, Authorization: `Bearer ${token}` };
}
