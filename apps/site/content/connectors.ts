export type Connector = { id: string; name: string; kind: "source" | "sender"; status: "live" | "roadmap" };

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
];

export const sources = () => CONNECTORS.filter((c) => c.kind === "source");
export const senders = () => CONNECTORS.filter((c) => c.kind === "sender");
export const connectorLabel = (c: Connector) => (c.status === "roadmap" ? `${c.name} (roadmap)` : c.name);
