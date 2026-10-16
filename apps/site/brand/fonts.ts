// The font registry's next/font half. Self-hosted (the CSP is font-src 'self'),
// module-scope loaders as next/font requires. Every font is declared so the
// /nexus/brand preview can show all presets at once; preload is off, so a browser
// only downloads the faces the page actually uses.
import { Figtree, Fraunces, IBM_Plex_Mono, Instrument_Serif, Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap", preload: false });
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap", preload: false });
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"], variable: "--font-instrument-serif", weight: "400", style: ["normal", "italic"], display: "swap", preload: false,
});
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap", preload: false });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-ibm-plex-mono", weight: ["400", "500"], display: "swap", preload: false });

/** Class names that define every --font-* variable; put them on <html>. */
export const fontVariables = [inter, figtree, instrumentSerif, fraunces, ibmPlexMono].map((f) => f.variable).join(" ");
