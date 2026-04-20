/**
 * FakeFetch — replaces globalThis.fetch in tests that touch BrazeClient.
 * Queue responses before making calls; inspect recorded requests after.
 */
export class FakeFetch {
  readonly requests: Array<{ url: string; method: string; body: unknown; headers: Record<string, string> }> = [];
  private queue: Array<{ body: unknown; status: number }> = [];

  queueResponse(body: unknown, status = 200) {
    this.queue.push({ body, status });
  }

  /** Use as globalThis.fetch replacement */
  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const body = init?.body ? JSON.parse(init.body as string) : null;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = init.headers as Record<string, string>;
      Object.entries(h).forEach(([k, v]) => { headers[k.toLowerCase()] = v; });
    }
    this.requests.push({ url, method: init?.method ?? "GET", body, headers });
    const next = this.queue.shift();
    if (!next) {
      // Default: success for Braze endpoints
      return new Response(JSON.stringify({ message: "success" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}
