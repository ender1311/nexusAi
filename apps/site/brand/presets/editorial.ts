import type { BrandPreset } from "../types";

/**
 * Editorial: newsprint contrast. Near-black ink on off-white, one strong red,
 * Fraunces display over Inter, sharp 2/4/6 corners, compact rhythm, centered hero.
 */
export const editorial = {
  id: "editorial",
  label: "Editorial",
  identity: {
    name: "Beacon Frontier",
    product: "Nexus",
    eyebrow: "Nexus · Beacon Frontier",
    logo: "monogram",
    ogTitle: "Nexus: AI decisioning for the stack you already have",
  },
  colorScheme: "light",
  light: {
    bg: "#faf8f3",
    surface: "#ffffff",
    surface2: "#f1eee6",
    ink: "#111111",
    ink2: "#333333",
    ink3: "#5c5c5c",
    line: "#d9d4c7",
    accent: "#c8102e",
    accentInk: "#b00d27",
    onAccent: "#ffffff",
    ok: "#1d6b3a",
    okBg: "#e4efe6",
    bad: "#a61b1b",
    badBg: "#f8e3e1",
    focus: "#c8102e",
    mark: "#f6d7d0",
    chart: ["#111111", "#c8102e", "#8a8a8a", "#d4a017"],
  },
  fonts: { display: "fraunces", body: "inter", mono: "ibm-plex-mono", displayWeight: "600", displayTracking: "-0.02em" },
  shape: { radiusSm: "2px", radius: "4px", radiusLg: "6px", radiusChip: "2px", shadow: "none", shadowPop: "none", borderWidth: "1px" },
  text: { labelCase: "uppercase", labelTracking: "0.12em", eyebrowCase: "uppercase", eyebrowTracking: "0.16em", btnCase: "uppercase", btnWeight: "700" },
  density: "compact",
  layout: { sections: ["hero", "simulator", "stack", "how", "offer", "comparison", "faq"], hero: "centered" },
} satisfies BrandPreset;
