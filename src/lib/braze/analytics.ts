import { cache } from "react";
import { unstable_cache } from "next/cache";
import { BrazeClient, createBrazeClient } from "./client";
import { TTL } from "@/lib/cache/ttl";

export class BrazeAnalytics {
  constructor(private client: BrazeClient) {}

  async fetchCampaignAnalytics(campaignId: string, sendId?: string, length = 30): Promise<Record<string, number> | null> {
    const params: Record<string, string | number> = { campaign_id: campaignId, length };
    if (sendId) params.send_id = sendId;

    const res = await this.client.get("/campaigns/data_series", params);
    if (!res.ok) return null;

    const data = await res.json();
    return this.aggregateDataSeries(data);
  }

  async fetchSendAnalytics(campaignId: string, sendId: string, length = 30): Promise<Record<string, number> | null> {
    const res = await this.client.get("/sends/data_series", {
      campaign_id: campaignId,
      send_id: sendId,
      length,
    });
    if (!res.ok) return null;

    const data = await res.json();
    return this.aggregateDataSeries(data);
  }

  private aggregateDataSeries(response: { data?: Array<Record<string, unknown>> }): Record<string, number> {
    const dataPoints = response.data ?? [];
    const totals: Record<string, number> = {};

    for (const point of dataPoints) {
      for (const [key, value] of Object.entries(point)) {
        if (key === "time" || key === "messages") continue;
        if (typeof value === "number" && !key.includes("rate")) {
          totals[key] = (totals[key] ?? 0) + value;
        }
      }

      const messages = point.messages;
      if (messages && typeof messages === "object") {
        for (const variations of Object.values(messages as Record<string, unknown>)) {
          if (!Array.isArray(variations)) continue;
          for (const stats of variations) {
            if (typeof stats !== "object" || !stats) continue;
            for (const [k, v] of Object.entries(stats as Record<string, unknown>)) {
              if (typeof v === "number" && !k.includes("rate") && !(k in totals)) {
                totals[k] = (totals[k] ?? 0) + v;
              }
            }
          }
        }
      }
    }

    return BrazeAnalytics.normalizeMetrics(totals);
  }

  static normalizeMetrics(metrics: Record<string, number>): Record<string, number> {
    const normalized: Record<string, number> = {
      sent: 0, sends: 0, total_opens: 0, direct_opens: 0,
      unique_opens: 0, unique_clicks: 0, clicks: 0, bounces: 0,
      unique_recipients: 0, ...metrics,
    };

    // Normalize sent/sends naming
    if (metrics.sends && !metrics.sent) normalized.sent = metrics.sends;
    if (metrics.sent && !metrics.sends) normalized.sends = metrics.sent;

    // Normalize opens
    if (metrics.opens && !metrics.total_opens) normalized.total_opens = metrics.opens;
    if (metrics.total_opens && !metrics.opens) normalized.opens = metrics.total_opens;

    const sentCount = normalized.sent || 0;
    const clickNumerator = normalized.unique_clicks || normalized.clicks || 0;
    const openNumerator = normalized.unique_opens || normalized.total_opens || 0;

    if (sentCount > 0) {
      normalized.open_rate = parseFloat(((openNumerator / sentCount) * 100).toFixed(2));
      normalized.click_rate = parseFloat(((clickNumerator / sentCount) * 100).toFixed(2));
    }

    return normalized;
  }
}

/**
 * Braze campaign direct/total open rates for the Nexus campaign, cached 4h.
 * Returns null when Braze is unconfigured or the call fails/times out.
 * Wraps an external HTTP call (3s AbortController timeout) — lives here, not in
 * the DB cache module, since it isn't a Prisma query.
 */
export const getCachedBrazeStats = cache(unstable_cache(
  async () => {
    const campaignId = process.env.BRAZE_NEXUS_CAMPAIGN_ID;
    if (!campaignId) return null;
    const brazeClient = createBrazeClient();
    if (!brazeClient) return null;
    try {
      const daysSince = 60;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      let res: Response;
      try {
        res = await brazeClient.get(
          "/campaigns/data_series",
          { campaign_id: campaignId, length: Math.max(daysSince, 3) },
          controller.signal,
        );
      } finally {
        clearTimeout(timeoutId);
      }
      if (!res.ok) return null;
      const data = await res.json() as { data?: Array<{ messages?: Record<string, unknown[]> }> };
      let sends = 0, directOpens = 0, totalOpens = 0;
      for (const point of (data.data ?? [])) {
        if (!point.messages) continue;
        for (const variations of Object.values(point.messages)) {
          if (!Array.isArray(variations)) continue;
          for (const v of variations) {
            const s = v as Record<string, unknown>;
            if (typeof s.sent === "number") sends += s.sent;
            else if (typeof s.sends === "number") sends += s.sends;
            if (typeof s.direct_opens === "number") directOpens += s.direct_opens;
            if (typeof s.total_opens === "number") totalOpens += s.total_opens;
          }
        }
      }
      if (sends === 0) return null;
      return {
        sends,
        directOpens,
        totalOpens,
        directOpenRate: parseFloat(((directOpens / sends) * 100).toFixed(2)),
        totalOpenRate: parseFloat(((totalOpens / sends) * 100).toFixed(2)),
      };
    } catch {
      return null;
    }
  },
  ["braze-campaign-stats"],
  { tags: ["braze-stats"], revalidate: TTL.LONG }
));
