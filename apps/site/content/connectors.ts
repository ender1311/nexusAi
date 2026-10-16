export type Connector = { id: string; name: string; kind: "source" | "sender" | "content"; status: "live" | "roadmap" };

// Flip a source to "live" only once its live check has passed.
export const CONTENT_SOURCE_STATUS = {
  contentful: "roadmap",
  sanity: "roadmap",
  "generic-json": "roadmap",
  "braze-catalog": "roadmap",
  "nexus-library": "live",
} as const;

export const CONNECTORS: Connector[] = [
  { id: "segment", name: "Segment", kind: "source", status: "roadmap" },
  { id: "snowflake", name: "Snowflake", kind: "source", status: "roadmap" },
  { id: "bigquery", name: "BigQuery", kind: "source", status: "roadmap" },
  { id: "hightouch", name: "Hightouch", kind: "source", status: "live" },
  { id: "csv", name: "Webhook / CSV", kind: "source", status: "roadmap" },
  { id: "braze", name: "Braze", kind: "sender", status: "live" },
  { id: "iterable", name: "Iterable", kind: "sender", status: "roadmap" },
  { id: "customerio", name: "Customer.io", kind: "sender", status: "roadmap" },
  { id: "onesignal", name: "OneSignal", kind: "sender", status: "roadmap" },
  { id: "twilio", name: "Twilio", kind: "sender", status: "roadmap" },
  { id: "sendgrid", name: "SendGrid", kind: "sender", status: "roadmap" },
  { id: "contentful", name: "Contentful", kind: "content", status: CONTENT_SOURCE_STATUS.contentful },
  { id: "sanity", name: "Sanity", kind: "content", status: CONTENT_SOURCE_STATUS.sanity },
  { id: "generic-json", name: "Generic JSON", kind: "content", status: CONTENT_SOURCE_STATUS["generic-json"] },
  { id: "braze-catalog", name: "Braze Catalog", kind: "content", status: CONTENT_SOURCE_STATUS["braze-catalog"] },
  { id: "nexus-library", name: "Nexus library", kind: "content", status: CONTENT_SOURCE_STATUS["nexus-library"] },
];

export const sources = () => CONNECTORS.filter((c) => c.kind === "source");
export const senders = () => CONNECTORS.filter((c) => c.kind === "sender");
export const contentSources = () => CONNECTORS.filter((c) => c.kind === "content");
export const connectorLabel = (c: Connector) => (c.status === "roadmap" ? `${c.name} (roadmap)` : c.name);
