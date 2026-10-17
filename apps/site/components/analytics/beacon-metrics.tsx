"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { pageview, startMetrics, trackCta, trackOutbound } from "@site/lib/metrics";

/**
 * Beacon Frontier's cookieless page views, engaged time, CTA clicks and
 * outbound clicks. Renders nothing. CTAs opt in with a data-cta attribute (a fixed slug), so
 * server components need no client code of their own.
 */
export function BeaconMetrics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!startMetrics()) return;
    // Capture phase, so a link that navigates in its own handler is still seen.
    function onClick(event: MouseEvent) {
      const target = event.target as Element | null;
      const cta = target?.closest?.("[data-cta]");
      const slug = cta?.getAttribute("data-cta");
      if (slug) trackCta(slug);
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (anchor && /^https?:$/.test(anchor.protocol) && anchor.host !== window.location.host) {
        trackOutbound(new URL(anchor.href));
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (startMetrics()) pageview();
  }, [pathname]);

  return null;
}
