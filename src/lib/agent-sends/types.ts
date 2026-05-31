// Shared types for the agent "sends" view — used by the API route
// (src/app/api/agents/[id]/sends/route.ts) and the client table component so the
// row shape stays in lock-step across the network boundary.

export type SendRowContext = {
  inLocalTime?: boolean;
  selectedVariantId?: string;
  variantScores?: Record<string, number>;
  [key: string]: unknown;
};

export type SendRow = {
  id: string;
  userId: string;
  channel: string;
  sentAt: string;
  scheduledFor: string | null;
  brazeScheduleId: string | null;
  variantId: string | null;
  variantName: string | null;
  variantTitle: string | null;
  variantBody: string;
  variantDeeplink: string | null;
  brazeSendId: string | null;
  personaName: string | null;
  personaColor: string | null;
  conversionAt: string | null;
  reward: number | null;
  decisionContext: SendRowContext | null;
  failed: boolean;
};

export type SortField = "sentAt" | "channel" | "persona" | "variant";
export type SortDir = "asc" | "desc";

export type Filters = {
  status: "all" | "success" | "failed" | "converted" | "pending";
  channel: string; // "all" or channel name
  persona: string; // "all" or persona name
};

export type GroupedRows = { dateKey: string; label: string; rows: SendRow[] }[];
