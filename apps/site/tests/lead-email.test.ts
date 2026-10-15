import { describe, expect, it } from "bun:test";
import { sendLeadEmail } from "@site/lib/leads/email";
import type { LeadRecord } from "@site/lib/leads/store";

const lead: LeadRecord = { id: "1", email: "ana@acme.io", company: "<script>x</script>", source: "csv", sender: "braze", useCase: "u", ipHash: "h", userAgent: "ua", createdAt: new Date() };

describe("sendLeadEmail", () => {
  it("escapes html and sets subject and reply_to", async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => { sent = { url, init }; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await sendLeadEmail(lead, { apiKey: "k", to: "to@x.io", from: "Nexus <n@x.io>", fetchImpl });
    const body = JSON.parse(String(sent!.init.body));
    expect(body.html).toContain("&#60;script&#62;x&#60;/script&#62;");
    expect(body.html).not.toContain("<script>");
    expect(body.subject).toBe("Nexus design partner: <script>x</script>");
    expect(body.reply_to).toBe("ana@acme.io");
    expect(sent!.init.signal).toBeDefined();
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(sendLeadEmail(lead, { apiKey: "k", to: "t", from: "f", fetchImpl })).rejects.toThrow("500");
  });
});
