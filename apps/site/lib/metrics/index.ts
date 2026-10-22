/**
 * Beacon Frontier's first-party, cookieless metrics for the Nexus zone. The
 * protocol and the event whitelist live in the beacon-frontier repo
 * (docs/metrics.md, src/metrics/sites.ts); `./client.ts` is a verbatim copy of
 * its reference client. Site id: "nexus".
 *
 * The client sends these by itself once started:
 *   pageview (from <BeaconMetrics />), _leave {sd}, _vitals, js_error {kind, from}
 *   cta_click {target}     any element with data-cta="<fixed slug>"
 *   outbound {host, kind}  any http(s) link to another host: host only, kind from data-kind (else "link")
 *
 * And this module, at each funnel step (sites.ts "nexus"):
 *   simulator_run {scenario}  the simulator's Run, with its preset's id
 *   demo_open {from}          the live demo link (data-kind="console"), with the link's data-cta id
 *   lead_start                the first field of the design-partner form focused (once per page view)
 *   lead_submit               a design-partner request the server accepted (no props)
 *   lead_error {reason}       the form refused or failed: invalid | rate_limited | server | network
 *   contact_click {via}       a call booking, email or LinkedIn link
 * plus demo_view and demo_step {n} for the step-by-step walkthrough, which
 * sites.ts doesn't list yet (PROPOSED_EVENTS; dropped until it does).
 * Never anything typed in the form, the address, or a link's path.
 *
 * Nothing is sent from previews or localhost: `metricsEndpoint()` returns null
 * unless the page is on beaconfrontier.com, or a local test set
 * NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT at build time.
 */

import { initMetrics, pageview as sendPageview, track, type Props } from "./client";

export const METRICS_SITE = "nexus";
export const METRICS_HOST = "beaconfrontier.com";
/** On the domain root, not under basePath: beaconfrontier.com serves the collector for every zone. */
export const METRICS_ENDPOINT = "/api/m";

export const SLUG = /^[a-z0-9_-]{1,40}$/;

type Rule = "slug" | "host" | readonly string[] | { int: readonly [number, number] };

/** sites.ts "nexus".events plus the common events this site sends. Keep in step with beacon-frontier. */
export const NEXUS_EVENTS: Record<string, Record<string, Rule>> = {
  pageview: {},
  _leave: { sd: { int: [0, 100] } },
  _vitals: { lcp: { int: [0, 120_000] }, inp: { int: [0, 60_000] }, cls: { int: [0, 100_000] } },
  js_error: { kind: ["error", "rejection"], from: ["app", "other"] },
  outbound: { host: "host", kind: "slug" },
  cta_click: { target: "slug" },
  simulator_run: { scenario: "slug" },
  demo_open: { from: "slug" },
  lead_start: {},
  lead_submit: {},
  lead_error: { reason: "slug" },
  contact_click: { via: ["email", "linkedin", "calendar", "other"] },
};

/** Asked for, not in sites.ts yet: the collector drops them until it lists them. */
export const PROPOSED_EVENTS: Record<string, Record<string, Rule>> = {
  demo_view: {},
  demo_step: { n: { int: [1, 6] } },
};

export type MetricEvent = { name: string; props?: Props };

/** The collector's own checks for one event, against a list (for the tests). */
export function isAllowed({ name, props = {} }: MetricEvent, list: Record<string, Record<string, Rule>> = NEXUS_EVENTS): boolean {
  const spec = list[name];
  if (!spec) return false;
  return Object.entries(props).every(([key, value]) => {
    const rule = spec[key];
    if (!rule) return false;
    if (rule === "slug") return typeof value === "string" && SLUG.test(value);
    if (rule === "host") return typeof value === "string" && /^[a-z0-9.-]{1,80}$/.test(value) && value.includes(".");
    if (Array.isArray(rule)) return typeof value === "string" && rule.includes(value);
    const [min, max] = (rule as { int: readonly [number, number] }).int;
    return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
  });
}

export function metricsEndpoint(
  hostname: string,
  debugEndpoint = process.env.NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT,
): string | null {
  if (debugEndpoint) return debugEndpoint;
  return hostname === METRICS_HOST ? METRICS_ENDPOINT : null;
}

let linksWatched = false;

/** Starts the client once, if this page may report, and the funnel's link steps with it. */
export function startMetrics(): boolean {
  if (typeof window === "undefined") return false;
  const endpoint = metricsEndpoint(window.location.hostname);
  if (!endpoint) return false;
  initMetrics(METRICS_SITE, endpoint);
  if (!linksWatched) {
    linksWatched = true;
    // Capture phase, so a link that navigates in its own handler is still seen.
    document.addEventListener(
      "click",
      (event) => {
        const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (anchor) trackLink({ href: anchor.href, kind: anchor.getAttribute("data-kind"), cta: anchor.getAttribute("data-cta") });
      },
      true,
    );
  }
  return true;
}

/** lead_start goes once per page view. */
let leadStarted = false;

/** A page view of the current location (each pathname change). */
export function pageview() {
  leadStarted = false;
  sendPageview();
}

const slug = (v: string | null | undefined, fallback: string) => (v && SLUG.test(v) ? v : fallback);

// ---- Pure builders (tested) ----

export const simulatorRunEvent = (presetId: string): MetricEvent => ({ name: "simulator_run", props: { scenario: slug(presetId, "other") } });
export const demoStepEvent = (n: number): MetricEvent | null =>
  Number.isInteger(n) && n >= 1 && n <= 6 ? { name: "demo_step", props: { n } } : null;

export type LeadErrorReason = "invalid" | "rate_limited" | "server" | "network";
/** Why the form failed, from the response status alone (never its body). Null status: the request never arrived. */
export function leadErrorReason(status: number | null): LeadErrorReason {
  if (status === null) return "network";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "invalid";
}

/**
 * The funnel event a link click is, beyond the client's own cta_click/outbound: the live demo
 * (data-kind="console") is demo_open, with the link's data-cta id as `from`; a call booking, an
 * email or LinkedIn is contact_click. Judged from the link's kind and host; never sends the path.
 */
export function linkEventFor(link: { href: string; kind?: string | null; cta?: string | null }): MetricEvent | null {
  if (link.kind === "console") return { name: "demo_open", props: { from: slug(link.cta, "link") } };
  let u: URL;
  try {
    u = new URL(link.href);
  } catch {
    return null;
  }
  if (u.protocol === "mailto:") return { name: "contact_click", props: { via: "email" } };
  const host = u.hostname.toLowerCase();
  if (link.kind === "calendly" || host === "calendly.com" || host.endsWith(".calendly.com")) return { name: "contact_click", props: { via: "calendar" } };
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return { name: "contact_click", props: { via: "linkedin" } };
  return null;
}

const send = (e: MetricEvent | null) => {
  if (e) track(e.name, e.props);
};

// ---- Funnel steps ----

export function trackSimulatorRun(presetId: string) {
  send(simulatorRunEvent(presetId));
}

/** The first focus in the design-partner form on this page view. */
export function trackLeadStart() {
  if (leadStarted) return;
  leadStarted = true;
  send({ name: "lead_start" });
}

/** A design-partner request the server accepted. No props: nothing typed in the form goes to metrics. */
export function trackLeadSubmit() {
  send({ name: "lead_submit" });
}

export function trackLeadError(status: number | null) {
  send({ name: "lead_error", props: { reason: leadErrorReason(status) } });
}

export function trackLink(link: { href: string; kind?: string | null; cta?: string | null }) {
  send(linkEventFor(link));
}

export function trackDemoView() {
  send({ name: "demo_view" });
}

export function trackDemoStep(n: number) {
  send(demoStepEvent(n));
}
