/**
 * Beacon Frontier's first-party, cookieless metrics for the Nexus zone. The
 * protocol and the event whitelist live in the beacon-frontier repo
 * (docs/metrics.md, src/metrics/sites.ts); `./client.ts` is a verbatim copy of
 * its reference client. Site id: "nexus", which may send only the common events:
 *
 *   pageview, _leave (engaged time)  from <BeaconMetrics />
 *   cta_click {target}               any element with data-cta="<fixed slug>"
 *   outbound {host, kind}            any http(s) link to another host
 *   lead_submit                      a design-partner request the server accepted (no props)
 *
 * Nothing is sent from previews or localhost: `metricsEndpoint()` returns null
 * unless the page is on beaconfrontier.com, or a local test set
 * NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT at build time.
 */

import { initMetrics, pageview, track } from "./client";

export const METRICS_SITE = "nexus";
export const METRICS_HOST = "beaconfrontier.com";
/** On the domain root, not under basePath: beaconfrontier.com serves the collector for every zone. */
export const METRICS_ENDPOINT = "/api/m";

export const SLUG = /^[a-z0-9_-]{1,40}$/;

export function metricsEndpoint(
  hostname: string,
  debugEndpoint = process.env.NEXT_PUBLIC_METRICS_DEBUG_ENDPOINT,
): string | null {
  if (debugEndpoint) return debugEndpoint;
  return hostname === METRICS_HOST ? METRICS_ENDPOINT : null;
}

/** Starts the client once, if this page may report. */
export function startMetrics(): boolean {
  if (typeof window === "undefined") return false;
  const endpoint = metricsEndpoint(window.location.hostname);
  if (!endpoint) return false;
  initMetrics(METRICS_SITE, endpoint);
  return true;
}

export { pageview };

/** A call to action. `target` is a developer-chosen slug from a data-cta attribute, never page text. */
export function trackCta(target: string) {
  if (SLUG.test(target)) track("cta_click", { target });
}

/** A design-partner request the server accepted. No props: nothing typed in the form goes to metrics. */
export function trackLeadSubmit() {
  track("lead_submit");
}

/** Where an outbound link goes, as a fixed slug. */
export function outboundKind(hostname: string): "calendly" | "console" | "external" {
  if (hostname === "calendly.com" || hostname.endsWith(".calendly.com")) return "calendly";
  if (hostname === "nexus-ai-demo-dl.vercel.app") return "console";
  return "external";
}

/** Host only, never the path. */
export function trackOutbound(url: URL) {
  const host = url.hostname.toLowerCase().slice(0, 80);
  track("outbound", { host, kind: outboundKind(host) });
}
