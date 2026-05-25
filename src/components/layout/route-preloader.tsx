"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function RoutePreloader() {
  const router = useRouter();

  useEffect(() => {
    router.prefetch("/");
    router.prefetch("/agents");
    router.prefetch("/performance");

    const t = setTimeout(() => {
      void fetch("/api/metrics/push-summary");
    }, 3000);

    return () => clearTimeout(t);
  }, [router]);

  return null;
}
