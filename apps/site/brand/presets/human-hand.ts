import type { BrandPreset } from "../types";

/**
 * Human Hand: Namesake's look. Evening navy ink on linen, clay accent, moss and
 * blush in support. Instrument Serif display, Figtree body, soft 12/16/28 radii,
 * uppercase tracked labels. Light only.
 */
export const humanHand = {
  id: "human-hand",
  label: "Human Hand",
  identity: {
    name: "Beacon Frontier",
    product: "Nexus",
    eyebrow: "Nexus by Beacon Frontier",
    logo: "beacon",
    ogTitle: "Nexus: AI decisioning for the stack you already have",
    ogDescription:
      "Nexus picks the right message, channel and time for each user, then learns from every send. Live today with Braze and Hightouch; more connectors on the roadmap.",
  },
  colorScheme: "light",
  light: {
    bg: "#f5f0e8",
    surface: "#ffffff",
    surface2: "#ede5d9",
    ink: "#1e2a44",
    ink2: "#3d4352",
    ink3: "#5b5e66",
    line: "#dcd2c3",
    accent: "#a65a3d",
    // Clay is 4.46:1 on linen, so small accent text uses a deeper clay (5.80:1).
    accentInk: "#8f4a30",
    // White on clay is 5.06:1.
    onAccent: "#ffffff",
    ok: "#2f6b45",
    okBg: "#e5ebdd",
    bad: "#8a3b2e",
    badBg: "#f6e4dc",
    focus: "#8f4a30",
    mark: "#ead7c9",
    chart: ["#1e2a44", "#a65a3d", "#7c8c5c", "#c08a52"],
  },
  fonts: { display: "instrument-serif", body: "figtree", mono: "ibm-plex-mono", displayWeight: "400", displayTracking: "0em" },
  shape: {
    radiusSm: "12px", radius: "16px", radiusLg: "28px", radiusChip: "999px",
    shadow: "0 1px 0 #dcd2c3", shadowPop: "0 16px 40px rgba(30, 42, 68, 0.14)", borderWidth: "1px",
  },
  text: { labelCase: "uppercase", labelTracking: "0.14em", eyebrowCase: "uppercase", eyebrowTracking: "0.14em", btnCase: "none", btnWeight: "600" },
  density: "airy",
  layout: { sections: ["hero", "stack", "simulator", "how", "comparison", "offer", "faq"], hero: "left" },
} satisfies BrandPreset;
