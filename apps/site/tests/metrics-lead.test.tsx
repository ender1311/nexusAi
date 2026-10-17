import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeadForm } from "@site/components/lead-form";
import { startMetrics } from "@site/lib/metrics";

// Drives the real client (lib/metrics/client.ts) with a debug endpoint and records what it would send.
const sent: { s: string; n: string; p?: unknown }[] = [];
const originalFetch = globalThis.fetch;
const originalBeacon = navigator.sendBeacon;
const originalEnv = process.env.NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT;
// happy-dom reports navigator.webdriver = true, which the client (correctly) treats as a bot and drops.
const webdriver = Object.getOwnPropertyDescriptor(navigator, "webdriver");

beforeAll(() => {
  process.env.NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT = "http://127.0.0.1:8787/m";
  Object.defineProperty(navigator, "webdriver", { configurable: true, get: () => false });
  Object.defineProperty(navigator, "sendBeacon", {
    configurable: true,
    value: (_url: string, body: string) => { sent.push(JSON.parse(body)); return true; },
  });
  expect(startMetrics()).toBe(true);
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  sent.length = 0;
});
afterAll(() => {
  if (webdriver) Object.defineProperty(navigator, "webdriver", webdriver);
  else delete (navigator as { webdriver?: boolean }).webdriver;
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: originalBeacon });
  if (originalEnv === undefined) delete process.env.NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT;
  else process.env.NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT = originalEnv;
});

function submit() {
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ana@acme.io" } });
  fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme" } });
  fireEvent.change(screen.getByLabelText("Use case to pilot"), { target: { value: "Win back trials" } });
  fireEvent.click(screen.getByRole("button", { name: /become a design partner/i }));
}

const leads = () => sent.filter((e) => e.n === "lead_submit");

describe("lead_submit metric", () => {
  it("fires once, with no props, when the server accepts the request", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 201 })) as unknown as typeof fetch;
    render(<LeadForm />);
    submit();
    await waitFor(() => expect(screen.getByTitle("Book a call")).toBeTruthy());
    expect(leads()).toEqual([expect.objectContaining({ s: "nexus", n: "lead_submit" })]);
    expect(leads()[0].p).toBeUndefined();
    expect(JSON.stringify(sent)).not.toMatch(/ana@acme|Acme|Win back/);
  });

  for (const [label, status] of [["validation error", 400], ["rate limit", 429], ["server error", 500]] as const) {
    it(`does not fire on a ${label} (${status})`, async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "nope" }), { status })) as unknown as typeof fetch;
      render(<LeadForm />);
      submit();
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(leads()).toHaveLength(0);
    });
  }

  it("does not fire on a network error", async () => {
    globalThis.fetch = mock(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    render(<LeadForm />);
    submit();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Network error"));
    expect(leads()).toHaveLength(0);
  });
});
