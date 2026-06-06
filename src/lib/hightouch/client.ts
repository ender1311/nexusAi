import type {
  HightouchSync,
  HightouchSyncRun,
  HightouchModel,
  HightouchSource,
  HightouchDestination,
} from "./types";

const BASE_URL = "https://api.hightouch.com/api/v1";

export class HightouchClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  private async get(
    endpoint: string,
    params: Record<string, string | number | boolean> = {},
    signal?: AbortSignal,
  ): Promise<Response> {
    const url = new URL(`${BASE_URL}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      return await fetch(url.toString(), {
        method: "GET",
        headers: this.headers(),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async post(endpoint: string, body: Record<string, unknown> = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      return await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async listSyncs(): Promise<HightouchSync[]> {
    const PAGE = 100;
    const all: HightouchSync[] = [];
    let offset = 0;
    for (;;) {
      const res = await this.get("/syncs", { limit: PAGE, offset });
      if (!res.ok) throw new Error(`Hightouch listSyncs failed: ${res.status}`);
      // The Hightouch v1 /syncs endpoint paginates via a boolean `hasMore`, not a
      // `pagination.total` count. Reading total caused the loop to stop at exactly
      // one full page (100), silently hiding syncs beyond it (e.g. all-givers-to-nexus).
      const json = (await res.json()) as { data: HightouchSync[]; hasMore?: boolean };
      all.push(...json.data);
      if (!json.hasMore || json.data.length === 0) break;
      offset += PAGE;
    }
    return all;
  }

  async getSync(id: string): Promise<HightouchSync> {
    const res = await this.get(`/syncs/${id}`);
    if (!res.ok) throw new Error(`Hightouch getSync failed: ${res.status}`);
    const json = (await res.json()) as { data: HightouchSync };
    return json.data;
  }

  async triggerSync(id: string, fullResync = false): Promise<{ id: string }> {
    // Hightouch's trigger endpoint takes an optional `fullResync` flag; omit it
    // for an incremental run so the body stays empty in the common case.
    const res = await this.post(`/syncs/${id}/trigger`, fullResync ? { fullResync: true } : {});
    if (!res.ok) throw new Error(`Hightouch triggerSync failed: ${res.status}`);
    return (await res.json()) as { id: string };
  }

  async getSyncRuns(id: string, limit = 20): Promise<HightouchSyncRun[]> {
    // Page via `hasMore` like listSyncs: the endpoint caps a single page at 100,
    // so a bare `limit` request silently truncates when more than 100 are asked
    // for. Accumulate until we have `limit` runs or the server reports no more.
    const PAGE = 100;
    const all: HightouchSyncRun[] = [];
    let offset = 0;
    while (all.length < limit) {
      const res = await this.get(`/syncs/${id}/runs`, {
        limit: Math.min(PAGE, limit - all.length),
        offset,
      });
      if (!res.ok) throw new Error(`Hightouch getSyncRuns failed: ${res.status}`);
      const json = (await res.json()) as { data: HightouchSyncRun[]; hasMore?: boolean };
      all.push(...json.data);
      if (!json.hasMore || json.data.length === 0) break;
      offset += json.data.length;
    }
    return all.slice(0, limit);
  }

  async listModels(): Promise<HightouchModel[]> {
    const res = await this.get("/models");
    if (!res.ok) throw new Error(`Hightouch listModels failed: ${res.status}`);
    const json = (await res.json()) as { data: HightouchModel[] };
    return json.data;
  }

  async listSources(): Promise<HightouchSource[]> {
    const res = await this.get("/sources");
    if (!res.ok) throw new Error(`Hightouch listSources failed: ${res.status}`);
    const json = (await res.json()) as { data: HightouchSource[] };
    return json.data;
  }

  async listDestinations(): Promise<HightouchDestination[]> {
    const res = await this.get("/destinations");
    if (!res.ok) throw new Error(`Hightouch listDestinations failed: ${res.status}`);
    const json = (await res.json()) as { data: HightouchDestination[] };
    return json.data;
  }
}

export function createHightouchClient(): HightouchClient | null {
  const apiKey = process.env.HIGHTOUCH_API_KEY;
  if (!apiKey) return null;
  return new HightouchClient(apiKey);
}
