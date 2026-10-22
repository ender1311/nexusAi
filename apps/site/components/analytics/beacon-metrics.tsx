"use client";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { pageview, startMetrics } from "@site/lib/metrics";

/**
 * Beacon Frontier's cookieless page views, one per pathname (the walkthrough's ?step= is not a new
 * page). Renders nothing. Once started, the client also sends engaged time, scroll depth, web
 * vitals, script-error counts, data-cta taps, outbound links and the funnel's link steps (the live
 * demo, booking a call) by itself, so server components need no client code of their own.
 */
export function BeaconMetrics() {
  const pathname = usePathname();

  useEffect(() => {
    if (startMetrics()) pageview();
  }, [pathname]);

  return null;
}
