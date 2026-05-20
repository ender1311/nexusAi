export class BrazeClient {
  private apiKey: string;
  private restUrl: string;

  constructor(apiKey: string, restUrl: string) {
    this.apiKey = apiKey;
    if (!restUrl.startsWith("http")) {
      restUrl = `https://${restUrl}`;
    }
    this.restUrl = restUrl.replace(/\/$/, "");
  }

  private headers() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  async post(endpoint: string, body: Record<string, unknown> = {}): Promise<Response> {
    const url = `${this.restUrl}${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      return await fetch(url, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async get(endpoint: string, params: Record<string, string | number | boolean> = {}, signal?: AbortSignal): Promise<Response> {
    const url = new URL(`${this.restUrl}${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    return fetch(url.toString(), {
      method: "GET",
      headers: this.headers(),
      signal,
    });
  }


}

export function createBrazeClient(): BrazeClient | null {
  const apiKey = process.env.BRAZE_API_KEY;
  const restUrl = process.env.BRAZE_REST_ENDPOINT ?? process.env.BRAZE_REST_URL;
  if (!apiKey || !restUrl) return null;
  return new BrazeClient(apiKey, restUrl);
}
