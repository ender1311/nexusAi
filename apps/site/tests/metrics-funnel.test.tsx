import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LeadForm } from "@site/components/lead-form";
import { Walkthrough } from "@site/components/demo/walkthrough";
import { Simulator } from "@site/components/simulator/simulator";
import { ConsoleLink } from "@site/components/sections/console-link";
import { chartThemes } from "@site/brand/chart-theme";
import { midnight } from "@site/brand/presets/midnight";
import { NEXUS_EVENTS, PROPOSED_EVENTS, isAllowed, pageview, startMetrics } from "@site/lib/metrics";

// Drives the real client (lib/metrics/client.ts) through real components and records every beacon.
type Body = { s: string; n: string; u: string; r?: string; p?: Record<string, string | number> };
const sent: Body[] = [];
const originalFetch = globalThis.fetch;
const originalBeacon = navigator.sendBeacon;
const originalEnv = process.env.NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT;
const webdriver = Object.getOwnPropertyDescriptor(navigator, "webdriver");

beforeAll(() => {
  process.env.NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT = "http://127.0.0.1:8787/m";
  // happy-dom reports navigator.webdriver = true, which the client (correctly) treats as a bot and drops.
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

const names = () => sent.map((e) => e.n).filter((n) => n !== "pageview");
/** Every beacon: an event sites.ts lists (or one proposed to it), with only its listed props. */
function expectAllAllowed() {
  for (const e of sent) {
    expect(e.s).toBe("nexus");
    const event = { name: e.n, props: e.p };
    expect(isAllowed(event) || isAllowed(event, PROPOSED_EVENTS)).toBe(true);
  }
}

function fill() {
  fireEvent.focus(screen.getByLabelText("Work email"));
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "ana@acme.io" } });
  fireEvent.focus(screen.getByLabelText("Company"));
  fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme" } });
  fireEvent.change(screen.getByLabelText("Use case to pilot"), { target: { value: "Win back trials" } });
  fireEvent.click(screen.getByRole("button", { name: /become a design partner/i }));
}

describe("design-partner form funnel", () => {
  it("lead_start once per page view, then lead_submit; nothing typed leaves the page", async () => {
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 201 })) as unknown as typeof fetch;
    pageview();
    render(<LeadForm />);
    fill();
    await waitFor(() => expect(screen.getByTitle("Book a call")).toBeTruthy());
    expect(names()).toEqual(["lead_start", "cta_click", "lead_submit"]);
    expect(sent.find((e) => e.n === "cta_click")?.p).toEqual({ target: "design-partner-submit" });
    expectAllAllowed();
    expect(JSON.stringify(sent)).not.toMatch(/ana@acme|acme\.io|Acme|Win back/);
  });

  for (const [status, reason] of [[400, "invalid"], [429, "rate_limited"], [500, "server"]] as const) {
    it(`a ${status} is lead_error {reason: ${reason}}, not lead_submit`, async () => {
      globalThis.fetch = mock(async () => new Response(JSON.stringify({ error: "Email ana@acme.io is invalid" }), { status })) as unknown as typeof fetch;
      pageview();
      render(<LeadForm />);
      fill();
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(sent.filter((e) => e.n === "lead_error").map((e) => e.p)).toEqual([{ reason }]);
      expect(names()).not.toContain("lead_submit");
      expectAllAllowed();
      expect(JSON.stringify(sent)).not.toMatch(/ana@acme|is invalid/);
    });
  }

  it("a network failure is lead_error {reason: network}", async () => {
    globalThis.fetch = mock(async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    pageview();
    render(<LeadForm />);
    fill();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Network error"));
    expect(sent.filter((e) => e.n === "lead_error").map((e) => e.p)).toEqual([{ reason: "network" }]);
    // The direct booking link offered with the error is a contact click and an outbound link (host only).
    fireEvent.click(screen.getByRole("link", { name: /book a call directly/i }));
    expect(sent.filter((e) => e.n === "contact_click").map((e) => e.p)).toEqual([{ via: "calendar" }]);
    expect(sent.filter((e) => e.n === "outbound").map((e) => e.p)).toEqual([{ host: "calendly.com", kind: "calendly" }]);
    expectAllAllowed();
  });
});

describe("demo and simulator", () => {
  it("the walkthrough: demo_view once, then demo_step for each step shown", () => {
    render(<Walkthrough initialStep={1} initialSource="contentful" product="Nexus" />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(sent.filter((e) => e.n === "demo_view")).toHaveLength(1);
    expect(sent.filter((e) => e.n === "demo_step").map((e) => e.p?.n)).toEqual([1, 2, 3, 2]);
    expect(sent.filter((e) => e.n === "cta_click").map((e) => e.p?.target)).toEqual(["demo-next", "demo-next", "demo-back"]);
    expectAllAllowed();
  });

  it("the simulator's Run is simulator_run with its preset", () => {
    render(<Simulator chartThemes={chartThemes(midnight)} product="Nexus" />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(sent.filter((e) => e.n === "simulator_run").map((e) => e.p)).toEqual([{ scenario: "winback" }]);
    expectAllAllowed();
  });

  it("the live demo link is demo_open {from} plus the client's cta_click and outbound", () => {
    render(<ConsoleLink />);
    fireEvent.click(screen.getByRole("link"));
    expect(names().sort()).toEqual(["cta_click", "demo_open", "outbound"]);
    expect(sent.find((e) => e.n === "demo_open")?.p).toEqual({ from: "console" });
    expect(sent.find((e) => e.n === "outbound")?.p).toEqual({ host: "nexus-ai-demo-dl.vercel.app", kind: "console" });
    expectAllAllowed();
  });
});

it("every event this site sends is either in sites.ts or proposed to it, never both", () => {
  for (const name of Object.keys(PROPOSED_EVENTS)) expect(NEXUS_EVENTS[name]).toBeUndefined();
});
