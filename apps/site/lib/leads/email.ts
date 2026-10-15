import type { LeadRecord } from "./store";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function sendLeadEmail(
  lead: LeadRecord,
  opts: { apiKey?: string; to: string; from: string; fetchImpl?: typeof fetch },
): Promise<void> {
  if (!opts.apiKey) throw new Error("RESEND_API_KEY is not set");
  const rows = [["Email", lead.email], ["Company", lead.company], ["Data source", lead.source], ["Sender", lead.sender], ["Use case", lead.useCase]];
  const res = await (opts.fetchImpl ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: opts.from,
      to: [opts.to],
      reply_to: lead.email,
      subject: `Nexus design partner: ${lead.company}`,
      html: `<table>${rows.map(([k, v]) => `<tr><td><b>${k}</b></td><td>${escapeHtml(v!)}</td></tr>`).join("")}</table>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend responded ${res.status}`);
}
