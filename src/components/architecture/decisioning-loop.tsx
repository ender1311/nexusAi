"use client";

import { useEffect, useRef, useState } from "react";

// Natural size of the standalone diagram (measured from the bundle). The iframe
// renders at this fixed size and is scaled to fit the container width.
const NATURAL_W = 1500;
const NATURAL_H = 987;

/**
 * Renders the animated "AI decisioning loop" diagram (a self-contained HTML
 * bundle) in an isolated iframe, scaled responsively to the container width.
 * A static PNG preview sits underneath and is shown if the animation fails to
 * load — so the section is never blank.
 */
export function DecisioningLoop() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setScale(entries[0].contentRect.width / NATURAL_W);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // If the iframe never signals load (network failure / hang), fall back to the image.
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setFailed((f) => (loaded ? f : true)), 8000);
    return () => clearTimeout(t);
  }, [loaded]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden rounded-2xl border bg-[#F4F1EC]"
      style={{ aspectRatio: `${NATURAL_W} / ${NATURAL_H}` }}
    >
      {/* Static preview — always underneath; visible until the animation loads. */}
      <img
        src="/embeds/nexus-decisioning-loop.png"
        alt="Nexus AI decisioning loop: warehouse data flows into the Nexus bandit engine, which delivers personalized messages and learns from engagement."
        className="absolute inset-0 h-full w-full object-contain"
      />
      {/* Animated diagram, scaled to fit; covers the preview once it loads. */}
      {!failed && scale > 0 && (
        <iframe
          src="/embeds/nexus-decisioning-loop.html"
          title="Nexus AI decisioning loop diagram"
          scrolling="no"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="absolute left-0 top-0 origin-top-left border-0 transition-opacity duration-700"
          style={{
            width: NATURAL_W,
            height: NATURAL_H,
            transform: `scale(${scale})`,
            opacity: loaded ? 1 : 0,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}
