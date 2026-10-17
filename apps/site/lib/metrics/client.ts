// The browser half of Beacon Frontier metrics, for apps built with a bundler (the studio, and the
// reference the zone apps copy). public/m.js is the same logic as a drop-in <script> for other sites.
// Protocol: docs/metrics.md. No cookies, no storage, no identifiers: the server derives a daily
// visitor hash from the request and throws the IP and user agent away.

export type Props = Record<string, string | number>;

interface State {
  site: string;
  endpoint: string;
  /** The page the next _leave belongs to. */
  url: string;
  /** The URL before this one, sent as the referrer of in-app navigations (the server drops same-site referrers). */
  prev: string;
  visibleSince: number;
  engaged: number;
}

let state: State | null = null;

/** Do Not Track, Global Privacy Control, and automated browsers: send nothing. */
export function optedOut(nav: Navigator & { globalPrivacyControl?: boolean }, win?: { doNotTrack?: string }): boolean {
  return nav.doNotTrack === "1" || win?.doNotTrack === "1" || nav.globalPrivacyControl === true || nav.webdriver === true;
}

function send(name: string, props?: Props, engagedMs?: number, url = state?.url) {
  if (!state || typeof window === "undefined" || optedOut(navigator, window as never)) return;
  const body = JSON.stringify({
    s: state.site,
    n: name,
    u: url,
    r: name === "pageview" ? state.prev || document.referrer || undefined : undefined,
    l: navigator.language,
    w: window.innerWidth,
    p: props && Object.keys(props).length ? props : undefined,
    d: engagedMs,
  });
  try {
    // A string body is sent as text/plain: a "simple" request, so no CORS preflight.
    if (!(navigator.sendBeacon && navigator.sendBeacon(state.endpoint, body))) {
      void fetch(state.endpoint, { method: "POST", body, keepalive: true, credentials: "omit" }).catch(() => {});
    }
  } catch {
    /* metrics never break the page */
  }
}

function flushLeave() {
  if (!state) return;
  const now = Date.now();
  if (state.visibleSince) state.engaged += now - state.visibleSince;
  state.visibleSince = document.visibilityState === "visible" ? now : 0;
  if (state.engaged >= 1000) send("_leave", undefined, Math.min(state.engaged, 30 * 60 * 1000));
  state.engaged = 0;
}

/**
 * Start measuring. Call once on the client. `endpoint` defaults to /api/m on this origin, which is the
 * collector for every zone of beaconfrontier.com.
 */
export function initMetrics(site: string, endpoint = "/api/m") {
  if (state || typeof window === "undefined") return;
  state = { site, endpoint, url: location.href, prev: "", visibleSince: document.visibilityState === "visible" ? Date.now() : 0, engaged: 0 };
  document.addEventListener("visibilitychange", () => {
    if (!state) return;
    if (document.visibilityState === "hidden") flushLeave();
    else state.visibleSince = Date.now();
  });
}

/** A page view of the current location. Call on first load and after each in-app navigation. */
export function pageview() {
  if (!state) return;
  if (state.url !== location.href) {
    flushLeave();
    state.prev = state.url;
    state.url = location.href;
  }
  send("pageview");
}

/** A named event with whitelisted props (src/metrics/sites.ts). Anything not listed is dropped by the server. */
export function track(name: string, props?: Props) {
  if (typeof window !== "undefined") send(name, props, undefined, location.href);
}
