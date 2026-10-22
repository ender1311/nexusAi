// Copied verbatim from beacon-frontier src/metrics/client.ts (the 2026-10-21 version, branch
// feat/analytics-all-sites at 709b996). Re-copy it when that file changes; don't edit it here.
//
// The browser half of Beacon Frontier metrics, for apps built with a bundler (the studio, and the
// reference the zone apps copy). public/m.js is the same logic as a drop-in <script> for other sites.
// Protocol: docs/metrics.md. No cookies, no storage, no identifiers: the server derives a daily
// visitor hash from the request and throws the IP and user agent away.
//
// What it sends on its own once started: page views (call pageview() on every navigation), engaged time and the
// deepest scroll when a page is left (`_leave {sd}`), the first page's Core Web Vitals once (`_vitals`: LCP and INP in
// ms, CLS × 1000, the browser's own PerformanceObserver, no library), uncaught script errors as a count
// (`js_error {kind, from}`, never the message, at most 5 per page load), clicks on elements with a `data-cta` id
// (`cta_click {target}`) and links to other hosts (`outbound {host, kind}`; `kind` is the link's `data-kind`, else
// "link"; mailto/tel send the kind only). An app that sends its own outbound events passes `autoClicks: false`. Every
// beacon carries the page's own language (`ul`, <html lang>). Everything else is `track()` with whitelisted props.

export type Props = Record<string, string | number>;

export interface MetricsOptions {
  /** Applied to every URL after cleanUrl (an app's own ids or codes in the path → ":id"). Return "" to send nothing. */
  redact?: (url: string) => string;
  /** Send cta_click / outbound for clicks automatically (default true). */
  autoClicks?: boolean;
  /** Send js_error for uncaught errors and rejections (default true). */
  errors?: boolean;
}

interface State {
  site: string;
  endpoint: string;
  /** The page the next _leave belongs to. */
  url: string;
  /** The URL before this one, sent as the referrer of in-app navigations (the server drops same-site referrers). */
  prev: string;
  visibleSince: number;
  engaged: number;
  redact: (url: string) => string;
  /** Deepest point seen on the current page, percent of its height. */
  scroll: number;
  /** The document's first page has reported its vitals (or had none to report). */
  vitalsSent: boolean;
  jsErrors: number;
}

let state: State | null = null;
/** Experiment → variant assignments the server rendered this page with (docs/experiments.md). */
let exposures: Record<string, string> | undefined;

/** Called with what the server assigned (it renders the variant; the browser only reports it). */
export function setExposures(x: Record<string, string> | undefined) {
  exposures = x && Object.keys(x).length ? x : undefined;
}

/** Do Not Track, Global Privacy Control, and automated browsers: send nothing. */
export function optedOut(nav: Navigator & { globalPrivacyControl?: boolean }, win?: { doNotTrack?: string }): boolean {
  return nav.doNotTrack === "1" || win?.doNotTrack === "1" || nav.globalPrivacyControl === true || nav.webdriver === true;
}

/**
 * What leaves the browser: origin + path, plus only utm_* and ref from the query. Apps keep state in the
 * query (Namesake puts the typed description in ?d=), and that must never be sent. No fragment.
 */
export function cleanUrl(href: string): string {
  try {
    const u = new URL(href);
    const keep = new URLSearchParams();
    u.searchParams.forEach((v, k) => {
      if (k.startsWith("utm_") || k === "ref") keep.append(k, v);
    });
    const q = keep.toString();
    return `${u.origin}${u.pathname}${q ? `?${q}` : ""}`;
  } catch {
    return "";
  }
}

// ---- Core Web Vitals (web.dev definitions, simplified: no back/forward-cache restores, no soft navigations) ---------

const vitals = { lcp: -1, cls: 0, clsWindow: 0, clsLast: 0, clsFirst: 0, inp: new Map<number, number>() };

function observe(type: string, cb: (entries: PerformanceEntry[]) => void, extra: Record<string, unknown> = {}) {
  try {
    if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    new PerformanceObserver((list) => cb(list.getEntries())).observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
  } catch {
    /* not supported here */
  }
}

function startVitals() {
  observe("largest-contentful-paint", (es) => {
    const last = es.at(-1);
    if (last) vitals.lcp = last.startTime;
  });
  observe("layout-shift", (es) => {
    for (const e of es as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
      if (e.hadRecentInput) continue;
      // Session windows: shifts less than 1 s apart, at most 5 s long; CLS is the worst window.
      if (vitals.clsWindow && e.startTime - vitals.clsLast < 1000 && e.startTime - vitals.clsFirst < 5000) vitals.clsWindow += e.value;
      else {
        vitals.clsWindow = e.value;
        vitals.clsFirst = e.startTime;
      }
      vitals.clsLast = e.startTime;
      vitals.cls = Math.max(vitals.cls, vitals.clsWindow);
    }
  });
  const onEvents = (es: PerformanceEntry[]) => {
    for (const e of es as (PerformanceEntry & { interactionId?: number })[]) {
      if (!e.interactionId) continue;
      vitals.inp.set(e.interactionId, Math.max(vitals.inp.get(e.interactionId) ?? 0, e.duration));
    }
  };
  observe("event", onEvents, { durationThreshold: 40 });
  observe("first-input", onEvents);
}

/** INP: the worst interaction, ignoring one in every 50 (the 98th percentile). Null with no interaction. */
export function inpOf(durations: number[]): number | null {
  if (!durations.length) return null;
  const s = [...durations].sort((a, b) => b - a);
  return s[Math.min(s.length - 1, Math.floor(s.length / 50))]!;
}

/** What `_vitals` sends: only the metrics this browser measured, rounded and bounded like the collector's rules. */
export function vitalsProps(v: { lcp: number; cls: number; inp: number[]; clsSeen: boolean }): Props | null {
  const p: Props = {};
  if (v.lcp >= 0) p.lcp = Math.min(120_000, Math.round(v.lcp));
  const inp = inpOf(v.inp);
  if (inp != null) p.inp = Math.min(60_000, Math.round(inp));
  if (v.clsSeen) p.cls = Math.min(100_000, Math.round(v.cls * 1000));
  return Object.keys(p).length ? p : null;
}

// ---- Scroll depth -------------------------------------------------------------------------------------------------

/** How far down the page the bottom of the window is, as a percent of the page's height (a page that fits is 100). */
export function scrollPercent(scrollY: number, viewport: number, height: number): number {
  if (!(height > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round(((scrollY + viewport) / height) * 100)));
}

const nextFrame = (cb: () => void) => (typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame(cb) : setTimeout(cb, 0));

function measureScroll() {
  if (!state || typeof document === "undefined" || !document.documentElement) return;
  const el = document.documentElement;
  state.scroll = Math.max(state.scroll, scrollPercent(window.scrollY ?? 0, window.innerHeight ?? 0, Math.max(el.scrollHeight ?? 0, document.body?.scrollHeight ?? 0)));
}

// ---- Clicks and errors --------------------------------------------------------------------------------------------

/** A `data-cta` id as the collector's slug, or null (it is a developer's fixed id, never the element's text). */
export function ctaSlug(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(s) ? s : null;
}

/** The event a click on this link sends, or null: another host (host only, never the path), mailto: or tel: (no address). */
export function outboundOf(href: string, pageHost: string): Props | null {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.protocol === "mailto:") return { kind: "mailto" };
  if (u.protocol === "tel:") return { kind: "tel" };
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.host === pageHost) return null;
  return { host: u.hostname.toLowerCase().replace(/^www\./, "").slice(0, 80), kind: "link" };
}

/** Whether an error came from our own scripts (same origin), judged locally from its file or stack; neither is sent. */
export function errorFrom(where: string | undefined, origin: string): "app" | "other" {
  return where && where.includes(`${origin}/`) ? "app" : "other";
}

/** At most this many script errors per page load: a loop that throws must not flood the collector. */
export const MAX_JS_ERRORS = 5;

function reportError(kind: "error" | "rejection", where: string | undefined) {
  if (!state || state.jsErrors >= MAX_JS_ERRORS) return;
  state.jsErrors += 1;
  track("js_error", { kind, from: errorFrom(where, location.origin) });
}

function onClick(e: MouseEvent) {
  const t = e.target as Element | null;
  if (!t || typeof t.closest !== "function") return;
  const cta = ctaSlug(t.closest("[data-cta]")?.getAttribute("data-cta"));
  if (cta) track("cta_click", { target: cta });
  const a = t.closest("a[href]") as HTMLAnchorElement | null;
  if (a) {
    const p = outboundOf(a.href, location.host);
    // A link may name its kind (data-kind="registrar"); a fixed developer slug, like data-cta.
    const kind = ctaSlug(a.getAttribute("data-kind"));
    if (p) track("outbound", kind && p.kind === "link" ? { ...p, kind } : p);
  }
}

// ---- Sending ------------------------------------------------------------------------------------------------------

function send(name: string, props?: Props, engagedMs?: number, url = state?.url) {
  if (!state || typeof window === "undefined" || optedOut(navigator, window as never)) return;
  const clean = (u: string | undefined) => {
    const c = cleanUrl(u ?? "");
    return c ? state!.redact(c) || undefined : undefined;
  };
  const u = clean(url);
  if (!u) return;
  const body = JSON.stringify({
    s: state.site,
    n: name,
    u,
    // Only the host is kept by the server; send no more than origin + path.
    r: name === "pageview" ? clean(state.prev || document.referrer) : undefined,
    l: navigator.language,
    ul: document.documentElement?.lang || undefined,
    w: window.innerWidth,
    p: props && Object.keys(props).length ? props : undefined,
    d: engagedMs,
    x: exposures,
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

/** Leaving the current page (another page, or the tab hidden): its vitals once, then engaged time and scroll depth. */
function flushLeave() {
  if (!state) return;
  const now = Date.now();
  if (state.visibleSince) state.engaged += now - state.visibleSince;
  state.visibleSince = document.visibilityState === "visible" ? now : 0;
  if (!state.vitalsSent) {
    state.vitalsSent = true;
    const clsSeen = typeof PerformanceObserver !== "undefined" && Boolean(PerformanceObserver.supportedEntryTypes?.includes("layout-shift"));
    const p = vitalsProps({ lcp: vitals.lcp, cls: vitals.cls, inp: [...vitals.inp.values()], clsSeen });
    if (p) send("_vitals", p);
  }
  if (state.engaged >= 1000) send("_leave", state.scroll ? { sd: state.scroll } : undefined, Math.min(state.engaged, 30 * 60 * 1000));
  state.engaged = 0;
}

/**
 * Start measuring. Call once on the client. `endpoint` defaults to /api/m on this origin, which is the
 * collector for every zone of beaconfrontier.com.
 */
export function initMetrics(site: string, endpoint = "/api/m", opts: MetricsOptions = {}) {
  if (state || typeof window === "undefined") return;
  state = {
    site,
    endpoint,
    url: location.href,
    prev: "",
    visibleSince: document.visibilityState === "visible" ? Date.now() : 0,
    engaged: 0,
    redact: opts.redact ?? ((u) => u),
    scroll: 0,
    vitalsSent: false,
    jsErrors: 0,
  };
  document.addEventListener("visibilitychange", () => {
    if (!state) return;
    if (document.visibilityState === "hidden") {
      measureScroll();
      flushLeave();
    } else state.visibleSince = Date.now();
  });
  let queued = false;
  window.addEventListener?.(
    "scroll",
    () => {
      if (queued) return;
      queued = true;
      nextFrame(() => {
        queued = false;
        measureScroll();
      });
    },
    { passive: true },
  );
  if (opts.autoClicks !== false) document.addEventListener("click", onClick, true);
  if (opts.errors !== false) {
    window.addEventListener?.("error", (e: ErrorEvent) => reportError("error", e.filename || (e.error as Error | undefined)?.stack));
    window.addEventListener?.("unhandledrejection", (e: PromiseRejectionEvent) => reportError("rejection", (e.reason as Error | undefined)?.stack));
  }
  startVitals();
}

/** A page view of the current location. Call on first load and after each in-app navigation. */
export function pageview() {
  if (!state) return;
  if (state.url !== location.href) {
    measureScroll();
    flushLeave();
    state.prev = state.url;
    state.url = location.href;
    state.scroll = 0;
  }
  send("pageview");
  // The new page's first screen counts as seen once it has laid out.
  nextFrame(measureScroll);
}

/** A named event with whitelisted props (src/metrics/sites.ts). Anything not listed is dropped by the server. */
export function track(name: string, props?: Props) {
  if (typeof window !== "undefined") send(name, props, undefined, location.href);
}
