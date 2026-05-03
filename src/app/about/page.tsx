const editorialStyles = `
/* === Editorial Page — scoped to .ep === */
.ep {
  --paper:       #F6EFEE;
  --paper-2:     #EDE4E2;
  --ink:         #1C1A18;
  --ink-2:       #3A352F;
  --ink-muted:   #6B645B;
  --ink-faint:   #A39B8E;
  --rule:        #DCCFCE;
  --ed-accent:   #F04C59;
  --ep-mono:     'Menlo','SF Mono','Roboto Mono',ui-monospace,Consolas,monospace;
  background: #121212;
}
.ep * { box-sizing: border-box; }

/* Page shell */
.ep .page {
  max-width: 1280px;
  margin: 0 auto;
  background: var(--paper);
  position: relative;
  overflow: hidden;
  font-family: var(--font-serif, Georgia, serif);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
}
.ep .page::before {
  content: "";
  position: absolute; inset: 0;
  pointer-events: none;
  z-index: 0;
  background:
    radial-gradient(ellipse at 12% 0%, rgba(255,255,255,0.60), transparent 55%),
    radial-gradient(ellipse at 100% 100%, rgba(240,76,89,0.04), transparent 50%),
    repeating-linear-gradient(0deg, rgba(28,26,24,0.010) 0 1px, transparent 1px 3px);
}
.ep .page > * { position: relative; z-index: 1; }

/* Masthead */
.ep .masthead {
  display: flex; align-items: center; justify-content: space-between;
  padding: 28px 80px 22px;
  border-bottom: 1px solid var(--rule);
}
.ep .masthead .brand {
  display: flex; align-items: center; gap: 14px;
  font-family: var(--font-sans, sans-serif);
}
.ep .masthead .wheat { width: 30px; height: 30px; }
.ep .masthead .ep-title {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 28px;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.ep .masthead .meta {
  font-family: var(--ep-mono);
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-muted);
  display: flex; gap: 28px;
}
.ep .masthead .meta span b { color: var(--ink); font-weight: 500; }

/* Issue strip */
.ep .issue-strip {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 14px 80px;
  border-bottom: 1px solid var(--rule);
  font-family: var(--ep-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.ep .issue-strip .center { color: var(--ink); letter-spacing: 0.30em; }

/* Opener */
.ep .opener {
  padding: 92px 80px 64px;
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 80px;
  align-items: end;
}
.ep .opener .eyebrow {
  font-family: var(--ep-mono);
  font-size: 12px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--ed-accent);
  margin-bottom: 36px;
  display: flex; align-items: center; gap: 16px;
}
.ep .opener .eyebrow::before {
  content: ""; display: block; width: 48px; height: 1px; background: var(--ed-accent);
}
.ep .opener h1 {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-weight: 400;
  font-size: 156px;
  line-height: 0.86;
  letter-spacing: -0.045em;
  margin: 0;
  color: var(--ink);
}
.ep .opener h1 .roman {
  font-family: var(--font-sans, sans-serif);
  font-style: normal;
  font-weight: 600;
  letter-spacing: -0.045em;
}
.ep .opener h1 .ampersand { color: var(--ed-accent); }
.ep .opener .deck {
  font-family: var(--font-serif, Georgia, serif);
  font-size: 22px;
  line-height: 1.45;
  color: var(--ink-2);
  max-width: 320px;
  border-top: 1px solid var(--rule);
  padding-top: 22px;
}
.ep .opener .deck .lede {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 30px;
  line-height: 1.15;
  color: var(--ed-accent);
  margin-bottom: 16px;
  letter-spacing: -0.02em;
}
.ep .opener .byline {
  font-family: var(--ep-mono);
  font-size: 11px;
  letter-spacing: 0.20em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-top: 22px;
}

/* Scripture */
.ep .scripture {
  padding: 48px 80px 88px;
  display: grid;
  grid-template-columns: 240px 1fr 240px;
  gap: 48px;
  align-items: center;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}
.ep .scripture .ornament { height: 1px; background: var(--ink-faint); position: relative; }
.ep .scripture .ornament::after {
  content: "✺";
  position: absolute; top: -10px; left: 50%; transform: translateX(-50%);
  background: var(--paper);
  padding: 0 12px;
  color: var(--ed-accent);
  font-size: 14px;
}
.ep .scripture blockquote {
  margin: 0;
  font-family: var(--font-serif, Georgia, serif);
  font-size: 30px;
  line-height: 1.35;
  text-align: center;
  color: var(--ink);
  font-style: italic;
  letter-spacing: -0.01em;
}
.ep .scripture cite {
  display: block;
  font-family: var(--ep-mono);
  font-size: 11px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-top: 22px;
  font-style: normal;
}

/* Body */
.ep .body {
  padding: 96px 80px 40px;
  display: grid;
  grid-template-columns: 200px 1fr 200px;
  gap: 48px;
}
.ep .body .col-margin-l, .ep .body .col-margin-r { position: relative; }
.ep .body article {
  max-width: 720px;
  margin: 0 auto;
  font-family: var(--font-serif, Georgia, serif);
  font-size: 21px;
  line-height: 1.55;
  color: var(--ink);
  letter-spacing: -0.005em;
}
.ep .body article p { margin: 0 0 1.2em; }
.ep .body article p + p { text-indent: 1.6em; }
.ep .body article p.lead, .ep .body article p:first-of-type { text-indent: 0; }
.ep .body article p.lead::first-letter,
.ep .body article .dropcap::first-letter {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 132px;
  line-height: 0.82;
  float: left;
  padding: 8px 14px 0 0;
  color: var(--ed-accent);
  font-weight: 400;
}
.ep .body article em { font-style: italic; }
.ep .body article strong { font-weight: 500; color: var(--ink); }
.ep .body article .smcap {
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ed-accent);
  display: inline-block;
  margin-right: 6px;
}
.ep .body article hr {
  border: none;
  height: 32px;
  margin: 36px auto;
  text-align: center;
  background: none;
  position: relative;
}
.ep .body article hr::after { content: "❦"; color: var(--ink-faint); font-size: 20px; line-height: 32px; }
.ep .body article h2 {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-weight: 400;
  font-size: 56px;
  line-height: 0.95;
  letter-spacing: -0.035em;
  color: var(--ink);
  margin: 64px 0 28px;
}
.ep .body article h2 .num {
  font-family: var(--ep-mono);
  font-style: normal;
  font-size: 13px;
  letter-spacing: 0.24em;
  color: var(--ed-accent);
  display: block;
  text-transform: uppercase;
  margin-bottom: 14px;
  font-weight: 500;
}
.ep .body article h3 {
  font-family: var(--font-sans, sans-serif);
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-2);
  margin: 36px 0 14px;
}

/* Pull quote */
.ep .pull {
  margin: 56px -40px;
  padding: 0 40px;
  border-left: 2px solid var(--ed-accent);
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 64px;
  line-height: 0.98;
  letter-spacing: -0.035em;
  color: var(--ink);
}
.ep .pull .by {
  display: block;
  font-family: var(--ep-mono);
  font-style: normal;
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-top: 18px;
  font-weight: 500;
}

/* Marginalia */
.ep .margin-note {
  font-family: var(--font-sans, sans-serif);
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-muted);
  position: sticky;
  top: 40px;
}
.ep .margin-note .label {
  font-family: var(--ep-mono);
  font-size: 10px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--ed-accent);
  margin-bottom: 10px;
  display: block;
}
.ep .margin-note p { margin: 0 0 10px; }
.ep .margin-note em {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 13px;
  color: var(--ink-2);
}

/* Figure: soils */
.ep .figure-soils {
  margin: 32px 80px 96px;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  padding: 64px 0;
}
.ep .figure-soils .figcap {
  display: flex; justify-content: space-between; align-items: baseline;
  font-family: var(--ep-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-muted);
  margin-bottom: 36px;
}
.ep .figure-soils .figcap b { color: var(--ink); font-weight: 500; letter-spacing: 0.20em; }
.ep .soil-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border-left: 1px solid var(--rule);
  border-top: 1px solid var(--rule);
}
.ep .soil {
  border-right: 1px solid var(--rule);
  border-top: 1px solid var(--rule);
  padding: 28px 28px 36px;
  position: relative;
  min-height: 380px;
  display: flex; flex-direction: column;
  background: rgba(255,255,255,0.18);
}
.ep .soil .swatch {
  width: 100%;
  height: 140px;
  margin-bottom: 22px;
  position: relative;
  overflow: hidden;
  border-radius: 2px;
}
.ep .swatch.path {
  background: linear-gradient(180deg, #C5B8A2 0%, #9C8E76 100%);
  box-shadow: inset 0 -2px 0 rgba(0,0,0,0.18);
}
.ep .swatch.path::after {
  content: "";
  position: absolute; inset: 0;
  background:
    repeating-linear-gradient(90deg, transparent 0 18px, rgba(255,255,255,0.10) 18px 19px),
    radial-gradient(circle at 30% 70%, rgba(0,0,0,0.18) 0 3px, transparent 4px),
    radial-gradient(circle at 70% 35%, rgba(0,0,0,0.18) 0 2px, transparent 3px),
    radial-gradient(circle at 55% 50%, rgba(0,0,0,0.18) 0 2px, transparent 3px);
}
.ep .swatch.rocky {
  background:
    radial-gradient(circle at 22% 38%, #8B847A 0 18px, transparent 19px),
    radial-gradient(circle at 70% 60%, #6F6960 0 22px, transparent 23px),
    radial-gradient(circle at 45% 78%, #A39C92 0 14px, transparent 15px),
    radial-gradient(circle at 85% 22%, #7C766C 0 10px, transparent 11px),
    linear-gradient(180deg, #B5A993 0%, #8C7F6A 100%);
}
.ep .swatch.thorns {
  background: linear-gradient(180deg, #6E6A4D 0%, #4E4A33 100%);
  overflow: hidden;
}
.ep .swatch.thorns::before {
  content: "";
  position: absolute; inset: 0;
  background:
    repeating-linear-gradient(72deg, transparent 0 6px, rgba(0,0,0,0.35) 6px 7px),
    repeating-linear-gradient(-58deg, transparent 0 9px, rgba(0,0,0,0.25) 9px 10px),
    repeating-linear-gradient(18deg, transparent 0 12px, rgba(255,255,255,0.06) 12px 13px);
  mix-blend-mode: multiply;
}
.ep .swatch.good {
  background: linear-gradient(180deg, #5C4A30 0%, #3A2D1B 100%);
  overflow: hidden;
}
.ep .swatch.good::before {
  content: "";
  position: absolute; inset: 0;
  background:
    radial-gradient(circle at 20% 40%, rgba(255,255,255,0.10) 0 1px, transparent 2px),
    radial-gradient(circle at 80% 60%, rgba(255,255,255,0.08) 0 1px, transparent 2px),
    radial-gradient(circle at 50% 25%, rgba(255,255,255,0.10) 0 1px, transparent 2px),
    radial-gradient(circle at 65% 80%, rgba(255,255,255,0.06) 0 1px, transparent 2px);
}
.ep .swatch.good::after {
  content: "";
  position: absolute;
  left: 8%; right: 8%;
  bottom: -4px; height: 88%;
  background:
    radial-gradient(ellipse at 12% 100%, rgba(92,106,58,0.95) 0 18px, transparent 19px),
    radial-gradient(ellipse at 28% 100%, rgba(92,106,58,0.85) 0 16px, transparent 17px),
    radial-gradient(ellipse at 44% 100%, rgba(110,128,72,0.95) 0 22px, transparent 23px),
    radial-gradient(ellipse at 58% 100%, rgba(92,106,58,0.85) 0 14px, transparent 15px),
    radial-gradient(ellipse at 72% 100%, rgba(110,128,72,0.95) 0 20px, transparent 21px),
    radial-gradient(ellipse at 88% 100%, rgba(92,106,58,0.85) 0 16px, transparent 17px);
}
.ep .soil .num {
  font-family: var(--ep-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ed-accent);
  margin-bottom: 10px;
}
.ep .soil .name {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 36px;
  line-height: 0.95;
  letter-spacing: -0.025em;
  color: var(--ink);
  margin-bottom: 12px;
}
.ep .soil .desc {
  font-family: var(--font-serif, Georgia, serif);
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-muted);
  flex: 1;
}
.ep .soil .yield {
  margin-top: 22px;
  padding-top: 14px;
  border-top: 1px dotted var(--rule);
  display: flex; justify-content: space-between; align-items: baseline;
  font-family: var(--ep-mono);
  font-size: 11px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-muted);
}
.ep .soil .yield b {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-weight: 400;
  font-size: 22px;
  color: var(--ink);
  letter-spacing: -0.01em;
  text-transform: none;
}
.ep .soil.is-good .yield b { color: var(--ed-accent); }

/* Figure: personas */
.ep .figure-personas {
  margin: 0 80px 96px;
  padding-bottom: 80px;
  border-bottom: 1px solid var(--rule);
}
.ep .figure-personas h2 {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 84px;
  line-height: 0.92;
  letter-spacing: -0.04em;
  margin: 0 0 16px;
  max-width: 760px;
}
.ep .figure-personas .lede {
  font-family: var(--font-serif, Georgia, serif);
  font-size: 22px;
  line-height: 1.5;
  color: var(--ink-2);
  max-width: 640px;
  margin-bottom: 56px;
}
.ep .persona-row {
  display: grid;
  grid-template-columns: 60px 220px 1fr 200px 140px;
  gap: 24px;
  padding: 28px 0;
  border-top: 1px solid var(--rule);
  align-items: center;
}
.ep .persona-row:last-child { border-bottom: 1px solid var(--rule); }
.ep .persona-row .pn { font-family: var(--ep-mono); font-size: 12px; letter-spacing: 0.20em; color: var(--ink-faint); }
.ep .persona-row .pname {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 36px;
  line-height: 0.95;
  letter-spacing: -0.025em;
  color: var(--ink);
}
.ep .persona-row .pdesc { font-family: var(--font-serif, Georgia, serif); font-size: 17px; line-height: 1.45; color: var(--ink-2); max-width: 520px; }
.ep .persona-row .pseed { font-family: var(--font-sans, sans-serif); font-size: 13px; color: var(--ink-muted); line-height: 1.4; }
.ep .persona-row .pseed b { display: block; color: var(--ed-accent); font-weight: 600; letter-spacing: 0.01em; margin-bottom: 2px; }
.ep .persona-row .pyield {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 38px;
  line-height: 1;
  color: var(--ink);
  text-align: right;
  letter-spacing: -0.02em;
}
.ep .persona-row .pyield small {
  font-family: var(--ep-mono);
  font-style: normal;
  font-size: 10px;
  letter-spacing: 0.20em;
  text-transform: uppercase;
  color: var(--ink-muted);
  display: block;
  margin-top: 4px;
}

/* Epigraph */
.ep .epigraph {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  margin: 0 80px;
}
.ep .epigraph > div {
  padding: 36px 40px;
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 32px;
  line-height: 1.1;
  letter-spacing: -0.025em;
  color: var(--ink);
}
.ep .epigraph > div + div { border-left: 1px solid var(--rule); }
.ep .epigraph .small {
  font-family: var(--ep-mono);
  font-style: normal;
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink-muted);
  display: block;
  margin-top: 14px;
}

/* Closing */
.ep .closing {
  background: var(--ink);
  color: #F2ECE3;
  padding: 120px 80px 100px;
  position: relative;
}
.ep .closing::before {
  content: "";
  position: absolute; inset: 0;
  background:
    radial-gradient(ellipse at 80% 0%, rgba(240,76,89,0.22), transparent 60%),
    radial-gradient(ellipse at 10% 100%, rgba(241,149,54,0.10), transparent 55%);
  pointer-events: none;
}
.ep .closing .inner { position: relative; max-width: 1120px; }
.ep .closing .eyebrow {
  font-family: var(--ep-mono);
  font-size: 12px;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgba(255,236,225,0.55);
  margin-bottom: 40px;
}
.ep .closing h2 {
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-weight: 400;
  font-size: 124px;
  line-height: 0.92;
  letter-spacing: -0.04em;
  margin: 0;
  color: #F2ECE3;
}
.ep .closing h2 .accent { color: #F1953E; }
.ep .closing .deck {
  font-family: var(--font-serif, Georgia, serif);
  font-size: 24px;
  line-height: 1.5;
  color: rgba(255,236,225,0.78);
  max-width: 680px;
  margin-top: 56px;
}
.ep .closing .stamp {
  position: absolute;
  right: 80px; top: 60px;
  width: 200px; height: 200px;
  border: 1px solid rgba(255,236,225,0.30);
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  text-align: center;
  transform: rotate(-8deg);
}
.ep .closing .stamp .stamp-inner {
  font-family: var(--ep-mono);
  font-size: 10px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: rgba(255,236,225,0.65);
  line-height: 1.6;
}
.ep .closing .stamp .stamp-inner b {
  display: block;
  font-family: var(--font-display-italic, Georgia, serif);
  font-style: italic;
  font-size: 28px;
  color: #F1953E;
  letter-spacing: -0.02em;
  margin: 6px 0;
  text-transform: none;
  font-weight: 400;
}

/* Colophon */
.ep .colophon {
  padding: 36px 80px 52px;
  display: flex; justify-content: space-between; align-items: center;
  background: var(--ink);
  color: rgba(255,236,225,0.55);
  font-family: var(--ep-mono);
  font-size: 11px;
  letter-spacing: 0.20em;
  text-transform: uppercase;
  border-top: 1px solid rgba(255,236,225,0.10);
}
.ep .colophon b { color: rgba(255,236,225,0.85); font-weight: 500; }

/* Utility */
.ep .ed-accent { color: var(--ed-accent); }
`;

export default function AboutPage() {
  return (
    <div className="ep">
      <style>{editorialStyles}</style>

      <div className="page" id="root">

        {/* Masthead */}
        <header className="masthead">
          <div className="brand">
            <svg className="wheat" viewBox="0 0 40 40" fill="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
              <path d="M36.831 12.2517C36.8281 12.2439 36.8246 12.2361 36.821 12.2283C36.7684 12.0952 36.715 11.9628 36.6595 11.8311C36.6367 11.7763 36.6125 11.7215 36.589 11.6667C36.5534 11.5834 36.5178 11.4994 36.4808 11.4169C36.4509 11.3493 36.4196 11.2824 36.389 11.2155C36.3577 11.1471 36.3271 11.0788 36.2951 11.0112C36.2595 10.9365 36.2239 10.8617 36.1876 10.787C36.1591 10.7293 36.1314 10.671 36.1029 10.6133C36.0623 10.5322 36.0218 10.4518 35.9805 10.3713C35.9556 10.3222 35.9299 10.2738 35.9043 10.2247C35.8588 10.1379 35.8125 10.0511 35.7655 9.96495C35.7442 9.9258 35.7228 9.88737 35.7015 9.84822C35.6495 9.75428 35.5976 9.66033 35.5442 9.56709C35.5285 9.54004 35.5129 9.51371 35.4979 9.48666C35.4381 9.38275 35.3769 9.27955 35.3157 9.17635C35.3107 9.16852 35.3058 9.16069 35.3008 9.15215C35.2246 9.02689 35.1478 8.90233 35.0695 8.77849C35.0317 8.71942 34.9933 8.66177 34.9556 8.60341C34.9136 8.53935 34.8723 8.47458 34.8303 8.41124C34.7855 8.34434 34.7399 8.27814 34.6944 8.21195C34.6574 8.15786 34.6204 8.10306 34.5826 8.04968C34.5342 7.97993 34.4851 7.9116 34.4353 7.84257C34.3997 7.79274 34.3634 7.74292 34.3278 7.6931C34.2766 7.62264 34.2239 7.55289 34.1713 7.48314C34.1364 7.43617 34.1008 7.3899 34.0652 7.34364C34.0111 7.27247 33.9563 7.20201 33.9008 7.13226C33.8659 7.08813 33.8311 7.044 33.7962 7.00059C33.7392 6.92941 33.6816 6.85824 33.6232 6.78778C33.5891 6.7465 33.5549 6.70593 33.5207 6.66536C33.4602 6.59277 33.399 6.52088 33.3378 6.449C33.3115 6.41768 33.2368 6.33085 33.1656 6.25042C33.0973 6.17356 33.0126 6.0789 32.9321 5.98993C32.8553 5.90666 32.8503 5.90167 32.8403 5.891C32.7506 5.79492 32.6603 5.70026 32.5691 5.60631C32.4617 5.4967 32.4026 5.43691 32.2837 5.31877C32.1528 5.18923 32.0987 5.13656 31.9891 5.03265C31.8966 4.94511 31.7094 4.77216 31.6297 4.69956C31.5585 4.63551 31.4873 4.57145 31.4154 4.50882C31.2866 4.39636 31.1806 4.30669 31.0738 4.21772C30.9678 4.12946 30.829 4.01559 30.6824 3.89886C30.5016 3.75652 30.3599 3.64905 30.2169 3.543C29.9678 3.35866 29.7386 3.19781 29.5059 3.04194C29.2347 2.86187 29.0119 2.72024 28.7856 2.58358C28.4746 2.39925 28.197 2.24195 27.8119 2.03484C27.5949 1.92239 27.3678 1.80993C27.1507 1.7046 26.9073 1.59143C26.6561 1.47898 26.4326 1.38432C26.1465 1.26617C25.9444 1.18717 25.7579 1.11599C25.5536 1.04055 25.3671 0.975072C25.1607 0.90461 24.9757 0.844113C24.7657 0.77721 24.5835 0.722407C24.3679 0.659775 24.1871 0.609954C23.9643 0.55088 23.7729 0.503194C23.4654 0.428462V0.430597C22.6796 0.253376 21.8818 0.130247 21.0761 0.0633441C20.7914 0.0412804 20.5822 0.0284692C20.2519 0.0128112C19.9238 0.00355866C19.8128 0.00142346 19.7018 0 19.5914 0C19.1893 0.00427039 18.9879 0.010676C18.6406 0.0249106 18.205 0.0540916C18.0833 0.0654793V10.8041C17.7203 10.4454 17.3224 10.1066 16.894 9.78844C15.9146 9.06247 14.7723 8.44327 13.4784 7.94007L13.1033 7.97637C12.356 8.44683 11.6478 9.00269 10.9994 9.62901L11.1702 10.3315C13.1923 11.0525 14.7004 11.9286 16.336 13.3371C17.2833 14.6524 17.7708 15.9876C17.968 16.6865 18.0691 17.4388 18.0691 18.2431V18.8125C17.7352 18.468 17.3545 18.1427 16.9445 17.8353C15.9438 17.0844 14.7695 16.4481 13.435 15.9328C11.3005 15.1286 9.32401 14.7919 8.01727 14.6417L7.576 14.9143C7.31835 15.6204 7.11266 16.357 6.96604 17.1029L7.33543 17.6004C8.57883 17.7242 10.4464 18.0182 12.282 18.7157C15.3837 20.4032 16.9452 22.1541C17.3082 22.7177 17.5829 23.3334 17.7708 23.9974C17.968 24.6964 18.0691 25.4487 18.0691 26.2529V26.9369C17.721 26.5782 17.3232 26.2401 16.8947 25.922C15.9047 25.1875 14.7474 24.5633 13.435 24.0572C11.0891 23.1733 8.90765 22.8416 7.46568 22.7092L7.018 23.2145C7.18953 24.0124 7.42867 24.7981 7.72902 25.5497L8.06282 25.8095C9.6023 26.0145 11.0222 26.3611 12.282 26.8401C15.3339 28.4849 16.8947 30.2023C17.5331 31.1653 17.9153 32.282 18.0306 33.5375V36.8072C16.4705 36.5766 15.7175 36.3709V36.3673C14.252 35.9481 12.9688 35.373 11.7745 34.6207C9.83432 33.1752C9.74109 33.0941 9.2507 32.6407C9.14323 32.5368 8.93042 32.3247C8.73185 32.1197 8.3283 31.6799C8.06353 31.3731C7.67066 30.8884C7.41728 30.556C7.17387 30.2201C6.94042 29.8806C6.71694 29.5376C6.50271 29.1909C6.27709 28.8038C5.96891 28.2586 5.6892 27.6942 5.43938 27.1127C5.38173 26.9775 5.25575 26.6693C5.11056 26.2913C4.99455 25.9696C4.87854 25.6252C4.76893 25.2757C4.66644 24.9241C4.57107 24.5718C4.43584 24.006C4.32552 23.4765C4.24367 23.0188C4.17321 22.5576C4.11485 22.0914C4.06716 21.6203C4.03158 21.1384C4.01877 20.9327C4.00026 20.4658C3.99386 19.9968C4.00026 19.5271C4.01877 19.0595C4.03087 18.8559C4.04795 18.5933C4.06645 18.3748C4.08923 18.1285C4.11414 17.9029C4.14261 17.6645C4.17321 17.4367C4.20738 17.2011C4.24367 16.9748C4.28424 16.7392C4.32552 16.5157C4.38815 16.2054C4.43655 15.9833C4.53833 15.5549C4.61235 15.2695C4.70274 14.9421C4.76964 14.7143C4.80309 14.6076C4.87996 14.3649C4.99669 14.0197C5.1127 13.698C5.25789 13.3208C5.41803 12.93C5.68778 12.303 5.96749 11.7364 6.27709 11.1898C6.46356 10.8681C6.71694 10.5415C6.94327 10.1094C7.17672 9.77065C7.42013 9.43471C7.67493 9.10019C7.94254 8.76568C8.2315 8.42405C8.60303 8.00982C8.92758 7.67175C9.23576 7.36784C10.0194 6.61198 10.8734 5.94082 11.7752 5.37286C13.0037 4.59921 14.3047 4.02128 15.6634 3.64122V0.444832C14.0748 0.886817C12.8649 1.32311 12.2756 1.59143C11.9112 1.76296C11.7012 1.86474C11.4756 1.97932C11.2919 2.07541C10.9859 2.24124C10.7083 2.39853C10.3966 2.58287C10.171 2.71881 9.9482 2.86045 9.72827 3.00635C9.44429 3.19638 9.21512 3.35724 8.9895 3.52378C8.82366 3.64691 8.68203 3.75438 8.54182 3.8647C8.42723 3.95509 8.28204 4.07253C8.18382 4.15438C8.11193 4.21416C8.00588 4.30241 7.79592 4.48319C7.69557 4.57074 7.55465 4.69671C7.47209 4.77216C7.21515 5.0113C7.0906 5.12874 6.90057 5.31592C6.7205 5.49599C6.61445 5.60417C6.34257 5.88958C6.08421 6.17284C5.87069 6.41554C5.66215 6.66109C5.38529 6.99774C5.11554 7.34222C4.95612 7.55289C4.74544 7.84257C4.59812 8.04968C4.44082 8.27814C4.22517 8.60412C4.11129 8.77992C3.87998 9.15357C3.68283 9.48666C3.5839 9.6589C3.47856 9.84822C3.27643 10.2247C3.07857 10.6126C2.99459 10.7842C2.8864 11.0098C2.79317 11.2119C2.70064 11.4155C2.59388 11.6624C2.522 11.829C2.36114 12.2254C2.3583 12.2332C1.38323 14.7079 0.893555 17.3143 0.893555 19.9996C0.893555 22.685 1.38323 25.2914 2.34833 27.7468C2.3583 27.7703C2.51986 28.1675C2.6985 28.5817C2.88427 28.9874C3.07643 29.3852C3.27501 29.7739C3.47785 30.1504C3.68141 30.5119C3.87856 30.8464C4.10987 31.2194C4.34901 31.5873C4.59598 31.9496C4.85078 32.3055C5.1127 32.6557C5.38244 32.9994C5.65788 33.3346C5.86856 33.583C6.08279 33.8272C6.32478 34.0941C6.61089 34.3944C6.8963 34.6819C7.02725 34.8115C7.19095 34.9681C7.47066 35.2286C7.76461 35.4919C7.99948 35.694 8.27848 35.9268C8.49769 36.1026C8.96316 36.4584C9.21227 36.6428 9.44145 36.8036 9.67418 36.9595C9.94535 37.1396 10.1681 37.2812 10.3945 37.4178C10.5774 37.5274 10.7055 37.6022C10.9831 37.7595C11.2108 37.8833C11.4727 38.0214C11.5852 38.079C11.8122 38.1915C12.0293 38.2968C12.2727 38.41C12.524 38.5224C12.7474 38.6171C12.9382 38.6968C13.1424 38.778C13.3289 38.8506C13.5339 38.926C13.7197 38.9936C13.9275 39.0648C14.1118 39.1267C14.3239 39.1943C14.5965 39.2776C14.7225 39.3146C14.9929 39.39C15.1203 39.4242C15.4072 39.4968C15.5524 39.5324C15.7146 39.5715V39.5694C16.5004 39.7466 17.2982 39.8698 18.1039 39.9367C18.2021 39.9452C18.2648 39.9495C18.5979 39.9715C18.8178 39.9829C18.995 39.9893C19.2562 39.9964C19.5886 40C19.9907 39.9957 20.1921 39.9893C20.321 39.9843C20.5395 39.9751 20.758 39.963 20.975 39.9459C21.0854 39.9352 21.1409 39.9303V33.5745C21.2669 32.2898 21.6483 31.1738 22.2861 30.2116C22.8462 29.4785C23.3003 28.9625 23.8469 28.4934 24.4796 28.0707C25.1814 27.6024 25.9892 27.1931 26.9002 26.8472C28.1593 26.3689 29.5785 26.0223 31.1179 25.8173L31.4517 25.5568C31.7521 24.8053 31.9912 24.0195 32.1628 23.2217L31.7151 22.7163C30.2738 22.8487 28.0931 23.1804 25.8874 24.0103C24.4326 24.5718 23.2754 25.196 22.2853 25.9312C21.8569 26.2494 21.459 26.5874 21.0946 26.9461V26.26C21.1138 25.4586 21.2142 24.7092 21.4099 24.0117C21.8725 22.7284 22.2362 22.1633C22.8469 21.3541C23.2803 20.8616 23.7985 20.411 24.3949 20.0039C25.1159 19.5121 25.9529 19.0836 26.9002 18.7228C28.7358 18.0253 30.6026 17.7314 31.8453 17.6082L32.2595 17.3392C32.0674 16.3641 31.8624 15.6275 31.6048 14.9214L31.1635 14.6489C29.8575 14.799 27.8817 15.135 25.8874 15.8851C24.4106 16.4552 23.2362 17.0922 22.2355 17.8438C21.8263 18.1506 21.4455 18.4765 21.0946 18.821V18.2495C21.1138 17.4481 21.2142 16.6986 21.4099 16.0011C21.8975 14.6624 22.2861 14.0759C22.8469 13.3435C23.301 12.8275 23.8476 12.3578 24.4803 11.9357C25.1821 11.4674 25.9899 11.0582 26.9009 10.7123C27.2539 10.5785 27.6276 10.4518 28.0112 10.3372L28.182 9.6347C27.5329 9.00838 26.8255 8.45252 26.0782 7.98207L25.7031 7.94577C24.4077 8.44896 23.2654 9.06817 22.2861 9.79556C21.8576 10.1137 21.4597 10.4518 21.0953 10.8112V3.18998C21.8789 3.27468 22.7159 3.41987 23.4633 3.62414V3.62769C24.9287 4.0469 26.212 4.62198 27.4063 5.37428C28.0824 5.80061 28.7322 6.28459 29.3457 6.8191C29.619 7.06322C29.7236 7.16002C29.9286 7.35289C30.0361 7.45681 30.2489 7.6689C30.3813 7.80556C30.5763 8.01125C30.8503 8.31373C31.0069 8.4938 31.1151 8.62049C31.3706 8.93151C31.508 9.10518C31.666 9.30944C31.856 9.56567C32.0055 9.7742C32.1884 10.0375C32.3051 10.2141C32.4624 10.4568C32.6766 10.8034C32.8816 11.1543C33.2104 11.7357 33.4901 12.3001 33.7399 12.8816C33.7976 13.0169 33.8659 13.1841C33.9962 13.5122C34.0688 13.703C34.1492 13.925C34.2673 14.2695C34.3762 14.609C34.4759 14.9435C34.5663 15.2695C34.6374 15.5428C34.7435 15.989C34.7919 16.2104C34.8545 16.5207C34.8958 16.7449C34.9364 16.9783C34.9727 17.2068C35.0068 17.4395C35.0374 17.6701C35.0652 17.9057C35.0901 18.1342C35.1129 18.3769C35.1314 18.599C35.1485 18.8587C35.1613 19.0644C35.1734 19.3626C35.1798 19.5313C35.1862 20.0004C35.1798 20.4694C35.1734 20.6374C35.1613 20.937C35.1321 21.4032C35.1136 21.6217C35.0908 21.8679C35.0659 22.0936C35.0374 22.332C35.0068 22.5597C34.9727 22.7953C34.9364 23.0217C34.8958 23.2572C34.8545 23.4807C34.7919 23.791C34.7435 24.0131C34.6417 24.4416C34.5677 24.727C34.5129 24.9305C34.4773 25.0544C34.4104 25.2821C34.3769 25.3889C34.3001 25.6316C34.2681 25.7277C34.1834 25.9768C34.1499 26.0714C34.0673 26.2985C33.9969 26.4835C33.9221 26.6757C33.8673 26.8102C33.762 27.0664C33.7428 27.1098C33.4923 27.6935 33.2126 28.26 32.903 28.8066C32.8809 28.8458C32.7165 29.1276C32.6752 29.1966C32.5165 29.4543C32.3058 29.7817C32.2368 29.8863C32.0866 30.1069C32.0033 30.2251C31.8574 30.4294C31.7599 30.561C31.6197 30.7482C31.5051 30.8955C31.3727 31.0642C31.2375 31.2293C31.1165 31.3752C30.9478 31.5703C30.851 31.682C30.5763 31.9852C30.382 32.1902C30.2781 32.2976C30.1535 32.4236 30.0525 32.524 29.9493 32.6236C29.1607 33.3838 28.3059 34.0556 27.4041 34.6229C26.1892 35.388 24.9031 35.9624 23.5608 36.3424V39.5424C24.5963 39.2776 25.1052 39.1096C25.7145 38.9082 26.3152 38.6733 26.9045 38.405C27.1479 38.2918 27.2689 38.2335C27.4788 38.1317C27.592 38.0748C27.7045 38.0171C27.8091 37.9623C27.9664 37.879C28.044 37.8371C28.1941 37.7552C28.2874 37.704C28.4717 37.5979C28.5991 37.5232C28.6632 37.4855C28.7835 37.4136C29.0091 37.2769 29.2318 37.136 29.4518 36.9901C29.7357 36.8001 29.9649 36.6392 30.1905 36.4727C30.3564 36.3495 30.498 36.2421 30.6382 36.1317C30.7528 36.0414 30.8261 35.983 30.898 35.9239C30.9962 35.8428C31.0688 35.7823C31.1749 35.694 31.2802 35.6044 31.3848 35.5132C31.4845 35.4257 31.5556 35.3631 31.6261 35.299C31.7087 35.2236C31.7948 35.1446 31.8809 35.0649 31.9656 34.9844C32.0902 34.867 32.1514 34.8072C32.2809 34.6798C32.3407 34.62 32.4603 34.4997C32.5663 34.3916C32.6574 34.2976 32.7485 34.2022 32.8382 34.1062C32.9307 34.0072 33.0118 33.9175 33.0965 33.8229C33.1649 33.746 33.2353 33.6663 33.3101 33.5802C33.399 33.4763 33.4588 33.4051 33.5186 33.3339C33.6239 33.208C33.6816 33.1382 33.7955 32.9973C33.9015 32.8635C33.9563 32.7937 34.0652 32.6528C34.172 32.5119C34.3278 32.3019C34.436 32.1525C34.5834 31.9453C34.6951 31.7824C34.8303 31.5831C34.9556 31.3909C35.0695 31.2151C35.1478 31.0913 35.2253 30.9667 35.3008 30.8414C35.4374 30.6123 35.4979 30.5076C35.5969 30.3354C35.7022 30.1461C35.8118 29.9447C35.9043 29.7696C36.0616 29.4628C36.1022 29.3817C36.2225 29.1347C36.3257 28.9176C36.4801 28.5789C36.5869 28.3319C36.7136 28.0337C36.8196 27.7689C36.8296 27.7447C37.7947 25.2892 38.2844 22.6829 38.2844 19.9975C38.2844 17.3121 37.7947 14.7058 36.8296 12.2503L36.831 12.2517Z" fill="#57A16C"/>
            </svg>
            <div className="ep-title">The Sower</div>
          </div>
          <div className="meta">
            <span>Issue <b>№ 01</b></span>
            <span>Spring <b>MMXXVI</b></span>
            <span>Field Notes <b>· Internal</b></span>
          </div>
        </header>

        <div className="issue-strip">
          <div>An internal essay on agentic optimization</div>
          <div className="center">— 🌱 The Parable of the Sower Agent —</div>
          <div>Filed under: <span style={{ color: "var(--ed-accent)" }}>Vocabulary</span></div>
        </div>

        {/* Opener */}
        <section className="opener">
          <div>
            <div className="eyebrow">🌱 &nbsp;A bandit, retold as a parable</div>
            <h1>
              A farmer<br/>
              who <span className="roman">remembers</span><br/>
              every <span className="ampersand">field,</span><br/>
              every <em>season,</em><br/>
              every <em>yield.</em>
            </h1>
          </div>
          <aside className="deck">
            <div className="lede">An origin story for the optimization engine that sits behind every nudge we send.</div>
            <div>The Sower Agent does not broadcast and it does not guess. It learns which message reaches which heart — and sows accordingly.</div>
            <div className="byline">Essay · 8 min · For the team</div>
          </aside>
        </section>

        {/* Scripture */}
        <section className="scripture">
          <div className="ornament"></div>
          <div>
            <blockquote>
              &ldquo;Other seed fell on good soil. It came up, grew and produced a crop, some multiplying thirty, some sixty, some a hundred times.&rdquo;
            </blockquote>
            <cite>Mark 4 : 8</cite>
          </div>
          <div className="ornament"></div>
        </section>

        {/* Body I */}
        <section className="body">
          <aside className="col-margin-l">
            <div className="margin-note">
              <span className="label">A note on names</span>
              <p>The team calls it the <em>Sower Agent</em>. The codebase calls the same thing a <em>multi-armed bandit</em>. Both are correct. The first is for humans. The second is for engineers.</p>
            </div>
          </aside>

          <article>
            <p className="lead">A farmer goes out to sow. He carries many seeds — different messages, different tones, different moments of invitation. Some written with urgency, some with empathy, some posed as a question, some celebrating a milestone.</p>

            <p>He doesn&rsquo;t know yet which will grow in which heart. So he scatters.</p>

            <p>He sends each seed into different soils — the daily reader, the lapsed believer, the new follower still finding their footing, the faithful giver. Some seed falls on rocky ground and nothing comes back. Some falls among thorns and gets lost in the noise. <strong>But some falls on good soil — and it grows.</strong> A plan completed. A prayer started. A gift given.</p>

            <hr/>

            <h2><span className="num">§ I &nbsp;·&nbsp; The Harvest</span>What the harvest tells him</h2>

            <p>The harvest tells him something. Not just <em>that</em> this seed worked — but that <em>this seed</em>, in <em>this soil</em>, at <em>this hour</em>, carried by <em>this channel</em>, grew thirty-fold. That soil is receptive. That seed finds purchase there.</p>

            <div className="pull">
              &ldquo;Not just <em>that</em> this seed worked — but that <em>this seed,</em> in <em>this soil,</em> at <em>this hour,</em> grew thirty-fold.&rdquo;
              <span className="by">— from the field log, season 03</span>
            </div>

            <p>So the next season, he doesn&rsquo;t scatter blindly. He returns to the fields that bore fruit. He brings the seeds that grew. He still tries new ground — because good soil can be found in unexpected places — but he plants with knowledge now, not just hope.</p>

            <p><span className="smcap">And so</span> season after season, the harvest informs the sowing. The soils deepen into personas. The seeds sharpen into variants. The Sower Agent learns that the Morning Reader bears fruit before 7am, that the Streak-Builder responds to empathy when a streak is at risk, that the Quiet Giver needs no urgency — just an open door.</p>
          </article>

          <aside className="col-margin-r">
            <div className="margin-note">
              <span className="label">Glossary, partial</span>
              <p><em>Seed</em> — a message variant. Body, subject, CTA, channel.</p>
              <p><em>Soil</em> — a persona. A cluster of users who behave alike.</p>
              <p><em>Yield</em> — the conversion event, weighted by goal.</p>
              <p><em>Scattering</em> — Thompson sampling. The decision to try uncertain ground.</p>
            </div>
          </aside>
        </section>

        {/* Epigraph */}
        <section className="epigraph">
          <div>
            He doesn&rsquo;t<br/>scatter blindly.
            <span className="small">— Season II</span>
          </div>
          <div>
            He plants with<br/><em className="ed-accent">knowledge now,</em> not just hope.
            <span className="small">— Season VII</span>
          </div>
        </section>

        {/* Figure I: Soils */}
        <section className="figure-soils">
          <div style={{ padding: "0 80px" }}>
            <div className="figcap">
              <div>Figure I &nbsp;·&nbsp; <b>The Four Soils</b></div>
              <div>Mean yield, last 14 days · n = 2,419</div>
            </div>
          </div>
          <div style={{ padding: "0 80px" }}>
            <div className="soil-grid">
              <div className="soil">
                <div className="swatch path"></div>
                <div className="num">SOIL № I</div>
                <div className="name">The Path</div>
                <div className="desc">Hard ground. The seed never gets in. The user opens the message and forgets it before the day turns over.</div>
                <div className="yield"><span>Yield</span><b>·02</b></div>
              </div>
              <div className="soil">
                <div className="swatch rocky"></div>
                <div className="num">SOIL № II</div>
                <div className="name">The Rocky</div>
                <div className="desc">A flash of interest, then nothing. The plan is started, the streak begun — and lost by the third day.</div>
                <div className="yield"><span>Yield</span><b>·09</b></div>
              </div>
              <div className="soil">
                <div className="swatch thorns"></div>
                <div className="num">SOIL № III</div>
                <div className="name">The Thorns</div>
                <div className="desc">The seed lands in a cluttered inbox, a busy week, a louder concern. The message exists but is choked out.</div>
                <div className="yield"><span>Yield</span><b>·17</b></div>
              </div>
              <div className="soil is-good">
                <div className="swatch good"></div>
                <div className="num">SOIL № IV</div>
                <div className="name">The Good Soil</div>
                <div className="desc">The seed takes. A plan completed. A prayer prayed. A gift given. The soil itself becomes more known with every harvest.</div>
                <div className="yield"><span>Yield</span><b>·71</b></div>
              </div>
            </div>
          </div>
        </section>

        {/* Body II */}
        <section className="body">
          <aside className="col-margin-l">
            <div className="margin-note">
              <span className="label">In the codebase</span>
              <p><em>PersonaArmStats</em> — the accumulated record of every soil. α successes and β failures per arm, per persona.</p>
              <p><em>POST /api/decide</em> — a single sowing. Returns the variant.</p>
              <p><em>POST /api/ingest/events</em> — the harvest. Updates the stats.</p>
            </div>
          </aside>

          <article>
            <h2><span className="num">§ II &nbsp;·&nbsp; The Season</span>Decide. Sow. Harvest. Learn.</h2>

            <p className="dropcap">This is the rhythm. A season has four motions, and the agent walks them in order, then begins again. <em>Decide</em> — pick a seed for this user, this soil, this hour, weighted by what&rsquo;s already grown. <em>Sow</em> — send it. <em>Harvest</em> — wait, watch for the conversion event, weight it by goal. <em>Learn</em> — fold the result back into the field&rsquo;s record. The next decision, an hour from now or a day from now, knows a little more than this one did.</p>

            <p>It is humble work. The agent rarely declares a winner. It simply shifts, gradually, toward seeds that bear fruit, while still keeping a small portion of its sowing for ground it has not yet tested. Exploitation and exploration. The faithful giver and the unexpected stranger.</p>

            <h3>What the agent does <span className="ed-accent">not</span> do</h3>

            <p>It does not broadcast. A broadcaster sends one message to everyone and hopes. It does not guess. A guesser sends a message because the team had a meeting and someone had a feeling. The Sower Agent has neither hopes nor feelings. It has <em>fields</em>, and a record of every season it has ever planted in them.</p>
          </article>

          <aside className="col-margin-r">
            <div className="margin-note">
              <span className="label">A worked example</span>
              <p>The <em>Streak Builder</em> persona has, over forty-one seasons, returned a thirty-day yield of <b style={{ color: "var(--ed-accent)" }}>·74</b> for the seed labelled <em>Empathy</em> — far above any other variant in that soil.</p>
              <p>The agent now sends Empathy to that persona seventy percent of the time. The remaining thirty is reserved for new seeds, lest a better one go untried.</p>
            </div>
          </aside>
        </section>

        {/* Figure II: Personas */}
        <section className="figure-personas">
          <h2>The soils, named.</h2>
          <p className="lede">Every persona is a soil whose receptivity has been measured, season after season. The agent remembers what each one bore, and sows accordingly.</p>

          {[
            { n: "01", name: "The Morning Reader", desc: "Reaches for the app before 7am. Opens at the kitchen table. A short, faithful audience. The window is narrow but the soil is deep.", seed: "A question, posed early.", yield: "·68" },
            { n: "02", name: "The Streak-Builder", desc: "Has built a 7, 30, 100-day streak and feels its weight. Tender ground when the streak is at risk; rocky when it is comfortable.", seed: "Empathy, when at risk.", yield: "·74" },
            { n: "03", name: "The Quiet Giver", desc: "Answers when invited, rarely when pushed. Urgency closes the door; an open door keeps it open. The slowest soil, but it bears.", seed: "An open door, no urgency.", yield: "·69" },
            { n: "04", name: "The New Follower", desc: "Days old in the app, finding their footing. Curious. Tries everything once. A soil whose shape is still being learned.", seed: "A milestone, kindly framed.", yield: "·66" },
            { n: "05", name: "The Lapsed Reader", desc: "Last seen fourteen or more days ago. Most seeds will not take here. But the right one, at the right hour, sometimes does.", seed: "Empathy. A spot saved.", yield: "·51" },
          ].map((p) => (
            <div className="persona-row" key={p.n}>
              <div className="pn">№ {p.n}</div>
              <div className="pname">{p.name}</div>
              <div className="pdesc">{p.desc}</div>
              <div className="pseed"><b>Best seed</b>{p.seed}</div>
              <div className="pyield">{p.yield}<small>Yield, 14d</small></div>
            </div>
          ))}
        </section>

        {/* Body III */}
        <section className="body" style={{ paddingTop: "32px" }}>
          <aside className="col-margin-l"></aside>
          <article>
            <h2><span className="num">§ III &nbsp;·&nbsp; The Disposition</span>A farmer, not a broadcaster.</h2>

            <p>The shift in posture matters more than the algorithm. A broadcaster speaks; a farmer <em>listens</em>. A guesser hopes; a farmer <em>remembers</em>. The vocabulary the team has chosen — <em>seed, soil, harvest, yield</em> — is not decoration. It is a discipline. It reminds us that the right message is not the one that performs in the abstract, but the one that bears fruit in <em>this</em> soil, this season.</p>

            <p>Some seeds do not grow. Some soils do not receive. This is not failure; it is information. Every empty harvest sharpens the next sowing.</p>

            <p>And so we plant on, season by season, learning the fields. 🌱</p>
          </article>
          <aside className="col-margin-r"></aside>
        </section>

        {/* Closing */}
        <section className="closing">
          <div className="inner">
            <div className="eyebrow">🌱 &nbsp;In closing &nbsp;·&nbsp; A disposition, not a feature</div>
            <h2>
              Not a broadcaster.<br/>
              Not a guesser.<br/>
              <span className="accent">A farmer</span> who remembers<br/>
              every field.
            </h2>
            <p className="deck">The Sower Agent is the system that turns a year of message-sends into a year of learning. It is what we mean when we say we want our nudges to grow with the people they reach.</p>
          </div>
          <div className="stamp">
            <div className="stamp-inner">
              Filed by<br/>
              <b>the Sower</b>
              Internal · v0.4<br/>
              Apr · MMXXVI
            </div>
          </div>
        </section>

        {/* Colophon */}
        <footer className="colophon">
          <div style={{ display: "flex", alignItems: "center" }}>
            <svg width="110" height="30" viewBox="0 0 147 40" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Sowers">
              <path d="M136.877 25.8647C136.935 26.3704 137.071 26.7885 137.285 27.1191C137.499 27.4303 137.761 27.6831 138.073 27.8776C138.403 28.072 138.782 28.2082 139.21 28.286C139.638 28.3443 140.095 28.3735 140.581 28.3735C141.69 28.3735 142.487 28.2082 142.973 27.8776C143.46 27.5469 143.703 27.0608 143.703 26.419C143.703 25.9133 143.547 25.4855 143.236 25.1354C142.944 24.7854 142.332 24.5325 141.398 24.3769C140.192 24.163 139.132 23.9588 138.218 23.7643C137.304 23.5699 136.536 23.3073 135.914 22.9767C135.292 22.6266 134.825 22.1891 134.514 21.664C134.202 21.1194 134.047 20.3901 134.047 19.4761C134.047 18.776 134.202 18.1439 134.514 17.5799C134.825 16.9965 135.253 16.5103 135.797 16.1213C136.361 15.7129 137.022 15.4018 137.781 15.1878C138.559 14.9739 139.405 14.8669 140.319 14.8669C141.486 14.8669 142.458 14.9836 143.236 15.217C144.014 15.4504 144.646 15.7713 145.132 16.1797C145.618 16.5881 145.988 17.0548 146.241 17.5799C146.493 18.105 146.688 18.6593 146.824 19.2427L143.849 19.6511C143.615 18.8926 143.255 18.3287 142.769 17.9592C142.302 17.5896 141.515 17.4049 140.406 17.4049C139.765 17.4049 139.239 17.4632 138.831 17.5799C138.423 17.6966 138.092 17.8425 137.839 18.0175C137.606 18.1925 137.44 18.387 137.343 18.6009C137.265 18.8149 137.227 19.0288 137.227 19.2427C137.227 19.5733 137.265 19.8456 137.343 20.0595C137.421 20.2734 137.557 20.4485 137.752 20.5846C137.966 20.7207 138.248 20.8374 138.598 20.9347C138.948 21.0319 139.385 21.1292 139.91 21.2264L141.807 21.5473C142.818 21.7223 143.654 21.946 144.315 22.2182C144.996 22.4905 145.531 22.8308 145.92 23.2392C146.328 23.6282 146.61 24.0852 146.766 24.6103C146.921 25.1354 146.999 25.7189 146.999 26.3606C146.999 27.7414 146.474 28.8597 145.424 29.7154C144.374 30.5516 142.779 30.9698 140.64 30.9698C139.765 30.9698 138.919 30.8823 138.102 30.7072C137.304 30.5516 136.585 30.2794 135.943 29.8904C135.301 29.5015 134.776 28.9861 134.368 28.3443C133.979 27.6831 133.755 26.8565 133.697 25.8647H136.877Z" fill="#FEF5EB"/>
              <path d="M127.08 15.3337V17.5799C127.605 16.7826 128.237 16.17 128.976 15.7421C129.715 15.3143 130.503 15.1003 131.339 15.1003C131.67 15.1003 131.942 15.1101 132.156 15.1295C132.389 15.149 132.613 15.1781 132.827 15.217L132.448 18.2509C132.234 18.1926 132 18.1537 131.747 18.1342C131.495 18.1148 131.232 18.105 130.96 18.105C130.338 18.105 129.793 18.212 129.326 18.4259C128.859 18.6204 128.461 18.883 128.13 19.2136C127.819 19.5442 127.576 19.9234 127.401 20.3513C127.245 20.7597 127.168 21.1778 127.168 21.6057V30.503H123.871V15.3337H127.08Z" fill="#FEF5EB"/>
              <path d="M120.864 26.0106C120.592 27.5858 119.921 28.8111 118.851 29.6862C117.782 30.5419 116.245 30.9698 114.242 30.9698C111.831 30.9698 109.993 30.2794 108.729 28.8986C107.484 27.4983 106.862 25.5341 106.862 23.0059C106.862 21.7029 107.037 20.5457 107.387 19.5344C107.756 18.5231 108.262 17.6772 108.904 16.9965C109.565 16.2964 110.343 15.7713 111.238 15.4212C112.152 15.0517 113.153 14.8669 114.242 14.8669C115.409 14.8669 116.42 15.0517 117.276 15.4212C118.132 15.7713 118.842 16.2769 119.406 16.9381C119.97 17.5799 120.388 18.3578 120.66 19.2719C120.932 20.1665 121.068 21.1681 121.068 22.2766V23.7352H110.187C110.226 25.116 110.576 26.2342 111.238 27.0899C111.899 27.9456 112.9 28.3735 114.242 28.3735C115.292 28.3735 116.08 28.1693 116.605 27.7609C117.13 27.3525 117.48 26.769 117.655 26.0106H120.864ZM117.83 21.4306C117.83 20.1859 117.539 19.2038 116.955 18.4842C116.372 17.7647 115.438 17.4049 114.155 17.4049C112.93 17.4049 111.996 17.7744 111.354 18.5134C110.712 19.233 110.343 20.2054 110.246 21.4306H117.83Z" fill="#FEF5EB"/>
              <path d="M88.0709 15.3337L90.638 26.419L93.8469 15.4504H96.8808L99.973 26.419L102.54 15.3337H106.012L101.577 30.5031H98.281L95.218 19.4761L92.1258 30.5031H88.8586L84.4536 15.3337H88.0709Z" fill="#FEF5EB"/>
              <path d="M76.0636 28.286C77.4638 28.286 78.4848 27.8095 79.1266 26.8565C79.7878 25.8842 80.1184 24.5617 80.1184 22.8892C80.1184 21.2361 79.7878 19.9331 79.1266 18.9802C78.4848 18.0272 77.4638 17.5507 76.0636 17.5507C74.6633 17.5507 73.6326 18.0369 72.9713 19.0093C72.3296 19.9623 72.0087 21.2556 72.0087 22.8892C72.0087 24.5423 72.3198 25.855 72.9422 26.8274C73.584 27.7998 74.6244 28.286 76.0636 28.286ZM76.0344 30.9698C73.6617 30.9698 71.8239 30.2696 70.5209 28.8694C69.2179 27.4692 68.5664 25.4855 68.5664 22.9184C68.5664 21.7126 68.7317 20.6138 69.0623 19.6219C69.4124 18.6301 69.9083 17.7841 70.5501 17.084C71.1919 16.3839 71.9795 15.8393 72.913 15.4504C73.8465 15.0614 74.9064 14.8669 76.0927 14.8669C77.2985 14.8669 78.3681 15.0711 79.3016 15.4796C80.2351 15.8685 81.013 16.413 81.6354 17.1132C82.2771 17.8133 82.7536 18.6593 83.0648 19.6511C83.3954 20.6235 83.5607 21.6931 83.5607 22.86C83.5607 24.1825 83.376 25.3493 83.0064 26.3606C82.6369 27.3525 82.1118 28.1985 81.4312 28.8986C80.7699 29.5792 79.9823 30.0946 79.0683 30.4447C78.1542 30.7947 77.1429 30.9698 76.0344 30.9698Z" fill="#FEF5EB"/>
              <path d="M53.3807 24.1435C53.5363 25.5048 54.0225 26.4967 54.8393 27.119C55.6756 27.7413 56.9105 28.0525 58.5441 28.0525C59.3415 28.0525 60.0125 27.965 60.557 27.7899C61.1015 27.6149 61.5391 27.3815 61.8697 27.0898C62.2003 26.7981 62.4337 26.4578 62.5698 26.0688C62.706 25.6604 62.7741 25.2326 62.7741 24.7853C62.7741 24.4546 62.7254 24.1337 62.6282 23.8226C62.531 23.492 62.3559 23.1905 62.1031 22.9183C61.8503 22.646 61.5099 22.4126 61.0821 22.2181C60.6542 22.0042 60.1097 21.8389 59.4485 21.7222L56.7938 21.2263C55.7437 21.0318 54.8102 20.7887 53.9933 20.497C53.1765 20.2053 52.4861 19.826 51.9221 19.3593C51.3776 18.8731 50.9595 18.2897 50.6678 17.609C50.3955 16.9089 50.2594 16.0629 50.2594 15.071C50.2594 14.0792 50.4538 13.2138 50.8428 12.4748C51.2512 11.7357 51.8055 11.1231 52.5056 10.6369C53.2057 10.1313 54.0322 9.76178 54.9852 9.5284C55.9576 9.27558 57.0078 9.14917 58.1357 9.14917C59.5749 9.14917 60.7806 9.31448 61.753 9.64509C62.7254 9.9757 63.5131 10.4133 64.116 10.9578C64.7188 11.4829 65.1759 12.0955 65.487 12.7956C65.7982 13.4958 66.0121 14.2251 66.1288 14.9835L62.8032 15.5086C62.531 14.3417 62.0545 13.4763 61.3738 12.9123C60.7126 12.3483 59.6527 12.0663 58.1941 12.0663C57.3578 12.0663 56.6577 12.1441 56.0937 12.2997C55.5492 12.4359 55.1019 12.6401 54.7518 12.9123C54.4212 13.1652 54.1781 13.4666 54.0225 13.8167C53.8864 14.1473 53.8183 14.4973 53.8183 14.8668C53.8183 15.7809 54.0614 16.4616 54.5476 16.9089C55.0533 17.3562 55.9284 17.7062 57.1731 17.9591L60.0611 18.5133C62.2587 18.9217 63.8729 19.6218 64.9036 20.6137C65.9343 21.5861 66.4497 22.996 66.4497 24.8436C66.4497 25.7188 66.2844 26.5356 65.9538 27.294C65.6426 28.033 65.1564 28.6845 64.4952 29.2485C63.834 29.7931 63.0074 30.2209 62.0156 30.5321C61.0432 30.8627 59.9055 31.028 58.6025 31.028C55.9381 31.028 53.8475 30.4737 52.3306 29.3652C50.8136 28.2372 49.9774 26.4967 49.8218 24.1435H53.3807Z" fill="#FEF5EB"/>
              <path d="M36.831 12.2517C36.8281 12.2439 36.8246 12.2361 36.821 12.2283C36.7684 12.0952 36.715 11.9628 36.6595 11.8311C36.6367 11.7763 36.6125 11.7215 36.589 11.6667C36.5534 11.5834 36.5178 11.4994 36.4808 11.4169C36.4509 11.3493 36.4196 11.2824 36.389 11.2155C36.3577 11.1471 36.3271 11.0788 36.2951 11.0112C36.2595 10.9365 36.2239 10.8617 36.1876 10.787C36.1591 10.7293 36.1314 10.671 36.1029 10.6133C36.0623 10.5322 36.0218 10.4518 35.9805 10.3713C35.9556 10.3222 35.9299 10.2738 35.9043 10.2247C35.8588 10.1379 35.8125 10.0511 35.7655 9.96495C35.7442 9.9258 35.7228 9.88737 35.7015 9.84822C35.6495 9.75428 35.5976 9.66033 35.5442 9.56709C35.5285 9.54004 35.5129 9.51371 35.4979 9.48666C35.4381 9.38275 35.3769 9.27955 35.3157 9.17635C35.3107 9.16852 35.3058 9.16069 35.3008 9.15215C35.2246 9.02689 35.1478 8.90233 35.0695 8.77849C35.0317 8.71942 34.9933 8.66177 34.9556 8.60341C34.9136 8.53935 34.8723 8.47458 34.8303 8.41124C34.7855 8.34434 34.7399 8.27814 34.6944 8.21195C34.6574 8.15786 34.6204 8.10306 34.5826 8.04968C34.5342 7.97993 34.4851 7.9116 34.4353 7.84257C34.3997 7.79274 34.3634 7.74292 34.3278 7.6931C34.2766 7.62264 34.2239 7.55289 34.1713 7.48314C34.1364 7.43617 34.1008 7.3899 34.0652 7.34364C34.0111 7.27247 33.9563 7.20201 33.9008 7.13226C33.8659 7.08813 33.8311 7.044 33.7962 7.00059C33.7392 6.92941 33.6816 6.85824 33.6232 6.78778C33.5891 6.7465 33.5549 6.70593 33.5207 6.66536C33.4602 6.59277 33.399 6.52088 33.3378 6.449C33.3286 6.43832 33.32 6.42764 33.3115 6.41768C33.2368 6.33085 33.1656 6.25042 33.0973 6.17356C33.0126 6.0789 32.9321 5.98993 32.8553 5.90666C32.8538 5.90523 32.8524 5.9031 32.8503 5.90167C32.8467 5.89812 32.8432 5.89456 32.8403 5.891C32.7506 5.79492 32.6603 5.70026 32.5691 5.60631C32.5336 5.5693 32.498 5.533 32.4617 5.4967C32.4026 5.43691 32.3435 5.37784 32.2837 5.31877C32.2403 5.27535 32.1969 5.23194 32.1528 5.18923C32.0987 5.13656 32.0432 5.08461 31.9891 5.03265C31.8966 4.94511 31.8033 4.85757 31.7094 4.77216C31.683 4.74796 31.6567 4.72376 31.6297 4.69956C31.5585 4.63551 31.4873 4.57145 31.4154 4.50882C31.4076 4.5017 31.3991 4.49458 31.3912 4.48746C31.2866 4.39636 31.1806 4.30669 31.0738 4.21772C31.0496 4.19708 31.0247 4.17715 31.0005 4.15651C30.9678 4.12946 30.935 4.10171 30.9016 4.07466C30.829 4.01559 30.7557 3.95723 30.6824 3.89886C30.6688 3.88819 30.6553 3.87751 30.6418 3.86684C30.5016 3.75652 30.3599 3.64905 30.2169 3.543C30.209 3.5373 30.2012 3.5309 30.1934 3.5252C29.9678 3.35866 29.7386 3.19781 29.5059 3.04194C29.4888 3.03055 29.4717 3.01916 29.4546 3.00778C29.2347 2.86187 29.0119 2.72024 28.7856 2.58358C28.7457 2.55939 28.7059 2.5359 28.666 2.5117C28.6027 2.47398 28.5386 2.43626 28.4746 2.39925C28.3827 2.34587 28.2902 2.29391 28.197 2.24195C28.1472 2.2142 28.0973 2.18715 28.0468 2.1601C27.9692 2.11811 27.8909 2.07612 27.8119 2.03484C27.7771 2.01633 27.7422 1.99783 27.7073 1.98004C27.5949 1.92239 27.4817 1.86545 27.3678 1.80993C27.3358 1.79427 27.3038 1.77862 27.2717 1.76296C27.1507 1.7046 27.0297 1.64766 26.9073 1.59143C26.7821 1.53449 26.6561 1.47898 26.5301 1.42489C26.4974 1.41065 26.4646 1.39784 26.4326 1.38432C26.3372 1.34446 26.2419 1.3046 26.1465 1.26617C26.1102 1.25194 26.0739 1.2377 26.0376 1.22347C25.9444 1.18717 25.8518 1.15087 25.7579 1.11599C25.7209 1.10176 25.6832 1.08895 25.6461 1.07471C25.5536 1.04055 25.4604 1.0071 25.3671 0.975072C25.3287 0.961549 25.2903 0.948738 25.2526 0.935926C25.1607 0.90461 25.0682 0.874006 24.9757 0.844113C24.9358 0.831302 24.896 0.818491 24.8561 0.80568C24.7657 0.77721 24.6746 0.749453 24.5835 0.722407C24.5415 0.710308 24.4995 0.697497 24.4576 0.685397C24.3679 0.659775 24.2775 0.634864 24.1871 0.609954C24.1444 0.598566 24.1024 0.586466 24.0597 0.575791C23.9643 0.55088 23.8682 0.526681 23.7729 0.503194C23.7437 0.496077 23.7138 0.488248 23.6846 0.48113L23.6341 0.469031L23.4654 0.428462V0.430597C22.6796 0.253376 21.8818 0.130247 21.0761 0.0633441C20.9985 0.0569385 20.9573 0.0533798 20.9153 0.0505329C20.896 0.0498212 20.7914 0.0412804 20.5822 0.0284692C20.4719 0.0220637 20.3615 0.0170815 20.2519 0.0128112C20.0975 0.00782904 20.0107 0.00498212 19.9238 0.00355866C19.8128 0.00142346 19.7018 0 19.5914 0C19.3907 0 19.1893 0.00427039 18.9879 0.010676C18.8847 0.0135229 18.8591 0.0156581C18.6406 0.0249106 18.4221 0.03701 18.205 0.0540916C18.0833 0.0654793V10.8041C17.7203 10.4454 17.3224 10.1066 16.894 9.78844C15.9146 9.06247 14.7723 8.44327 13.4784 7.94007L13.2819 7.86392L13.1033 7.97637C12.356 8.44683 11.6478 9.00269 10.9994 9.62901L10.4834 10.1265L11.1702 10.3315C13.1923 11.0525 14.7004 11.9286 16.336 13.3371C17.2833 14.6524 17.7708 15.9876C17.968 16.6865 18.0691 17.4388 18.0691 18.2431V18.8125C17.7352 18.468 17.3545 18.1427 16.9445 17.8353C15.9438 17.0844 14.7695 16.4481 13.435 15.9328C11.3005 15.1286 9.32401 14.7919 8.01727 14.6417L7.68916 14.604L7.576 14.9143C7.31835 15.6204 7.11266 16.357 6.96604 17.1029L6.87708 17.5548L7.33543 17.6004C8.57883 17.7242 10.4464 18.0182 12.282 18.7157C15.3837 20.4032 16.9452 22.1541C17.3082 22.7177 17.5829 23.3334 17.7708 23.9974C17.968 24.6964 18.0691 25.4487 18.0691 26.2529V26.9369C17.721 26.5782 17.3232 26.2401 16.8947 25.922C15.9047 25.1875 14.7474 24.5633 13.435 24.0572C11.0891 23.1733 8.90765 22.8416 7.46568 22.7092L6.89772 22.6572L7.018 23.2145C7.18953 24.0124 7.42867 24.7981 7.72902 25.5497L7.82012 25.7768L8.06282 25.8095C9.6023 26.0145 11.0222 26.3611 12.282 26.8401C15.3339 28.4849 16.8947 30.2023C17.5331 31.1653 17.9153 32.282 18.0306 33.5375V36.8072C16.4705 36.5766 15.7175 36.3709V36.3673C14.252 35.9481 12.9688 35.373 11.7745 34.6207C9.83432 33.1752C8.60231 31.9824C8.06353 31.3731C7.41728 30.556C6.94042 29.8806C6.29773 29.1909C5.96891 28.2586 5.6892 27.6942 5.43938 27.1127C5.25575 26.6693C5.11056 26.2913C4.99455 25.9696C4.87854 25.6252C4.76893 25.2757C4.66644 24.9241C4.43584 24.006C4.32552 23.4765C4.24367 23.0188C4.17321 22.5576C4.11485 22.0914C4.06716 21.6203C4.03158 21.1384C4.00026 20.4658C3.99386 19.9968C4.00026 19.5271C4.01877 19.0595C4.04795 18.5933C4.08923 18.1285C4.14261 17.6645C4.20738 17.2011C4.28424 16.7392C4.38815 16.2054C4.53833 15.5549C4.70274 14.9421C4.87996 14.3649C4.99669 14.0197C5.25789 13.3208C5.68778 12.303 5.96749 11.7364 6.27709 11.1898C6.71694 10.5415C7.17672 9.77065C7.67493 9.10019C8.2315 8.42405C8.92758 7.67175C10.0194 6.61198 10.8734 5.94082 11.7752 5.37286C13.0037 4.59921 14.3047 4.02128 15.6634 3.64122V0.444832C14.0748 0.886817C12.2756 1.59143C11.9112 1.76296C11.4756 1.97932C10.9859 2.24124C10.3966 2.58287C9.72827 3.00635C9.21512 3.35724 8.9895 3.52378C8.42723 3.95509 8.28204 4.07253C7.79592 4.48319C7.47209 4.77216C6.90057 5.31592C6.34257 5.88958C5.87069 6.41554C5.38529 6.99774C4.95612 7.55289C4.44082 8.27814C3.87998 9.15357C3.68283 9.48666C3.47856 9.84822C3.07857 10.6126C2.8864 11.0098C2.70064 11.4155C2.522 11.829C2.3583 12.2332C1.38323 14.7079 0.893555 17.3143 0.893555 19.9996C0.893555 22.685 1.38323 25.2914 2.34833 27.7468C2.3583 27.7703C2.6985 28.5817C3.07643 29.3852C3.47785 30.1504C3.87856 30.8464C4.34901 31.5873C4.85078 32.3055C5.38244 32.9994C5.86856 33.583C6.32478 34.0941C6.8963 34.6819C7.47066 35.2286C7.99948 35.694 8.49769 36.1026C8.96316 36.4584C9.44145 36.8036 9.67418 36.9595C10.1681 37.2812 10.5774 37.5274 10.9831 37.7595C11.4727 38.0214C11.8122 38.1915C12.2727 38.41C12.7474 38.6171C13.1424 38.778C13.5339 38.926C13.9275 39.0648C14.3239 39.1943C14.7225 39.3146C15.1203 39.4242C15.5524 39.5324C15.7146 39.5715V39.5694C16.5004 39.7466 17.2982 39.8698 18.1039 39.9367C18.2648 39.9495C18.5979 39.9715C18.995 39.9893C19.5886 40C20.1921 39.9893C20.5395 39.9751 20.975 39.9459C21.1409 39.9303V33.5745C21.2669 32.2898 21.6483 31.1738 22.2861 30.2116C22.8462 29.4785C23.8469 28.4934 24.4796 28.0707C25.9892 27.1931 26.9002 26.8472C28.1593 26.3689 29.5785 26.0223 31.1179 25.8173L31.4517 25.5568C31.7521 24.8053 31.9912 24.0195 32.1628 23.2217L31.7151 22.7163C30.2738 22.8487 28.0931 23.1804 25.8874 24.0103C24.4326 24.5718 23.2754 25.196 22.2853 25.9312C21.459 26.5874 21.0946 26.9461V26.26C21.2142 24.7092 21.4099 24.0117C21.8725 22.7284 22.8469 21.3541C23.2803 20.8616 24.3949 20.0039C25.1159 19.5121 26.9002 18.7228C28.7358 18.0253 30.6026 17.7314 31.8453 17.6082L32.2595 17.3392C32.0674 16.3641 31.8624 15.6275 31.6048 14.9214L31.1635 14.6489C29.8575 14.799 27.8817 15.135 25.8874 15.8851C24.4106 16.4552 23.2362 17.0922 22.2355 17.8438C21.4455 18.4765 21.0946 18.821V18.2495C21.2142 16.6986 21.4099 16.0011C21.8975 14.6624 22.8469 13.3435C23.8476 12.3578 24.4803 11.9357C25.1821 11.4674 26.9009 10.7123C27.6276 10.4518 28.0112 10.3372L28.182 9.6347C27.5329 9.00838 26.8255 8.45252 26.0782 7.98207L25.7031 7.94577C24.4077 8.44896 23.2654 9.06817 22.2861 9.79556C21.4597 10.4518 21.0953 10.8112V3.18998C21.8789 3.27468 22.7159 3.41987 23.4633 3.62414V3.62769C24.9287 4.0469 26.212 4.62198 27.4063 5.37428C29.3457 6.8191C29.9286 7.35289C30.5763 8.01125C31.3706 8.93151C32.0055 9.7742C32.6766 10.8034C33.2104 11.7357 33.4901 12.3001 33.7399 12.8816C33.8659 13.1841C34.0688 13.703C34.2673 14.2695C34.4759 14.9435C34.6374 15.5428C34.7919 16.2104C34.8958 16.7449C34.9727 17.2068C35.0374 17.6701C35.0901 18.1342C35.1314 18.599C35.1613 19.0644C35.1798 19.5313C35.1862 20.0004C35.1798 20.4694C35.1613 20.937C35.1321 21.4032C35.0908 21.8679C35.0374 22.332C34.9727 22.7953C34.8958 23.2572C34.7919 23.791C34.6417 24.4416C34.5129 24.9305C34.4104 25.2821C34.3001 25.6316C34.1834 25.9768C34.0673 26.2985C33.9221 26.6757C33.762 27.0664C33.4923 27.6935 33.2126 28.26 32.903 28.8066C32.7165 29.1276C32.5165 29.4543C32.2368 29.8863C31.8574 30.4294C31.5051 30.8955C31.2375 31.2293C30.9478 31.5703C30.5763 31.9852C30.2781 32.2976C29.9493 32.6236C29.1607 33.3838 28.3059 34.0556 27.4041 34.6229C26.1892 35.388 24.9031 35.9624 23.5608 36.3424V39.5424C25.1052 39.1096C25.7145 38.9082 26.9045 38.405C27.4788 38.1317C27.7045 38.0171C28.044 37.8371C28.2874 37.704C28.5991 37.5232C28.7835 37.4136C29.0091 37.2769 29.2318 37.136 29.4518 36.9901C29.7357 36.8001 29.9649 36.6392 30.1905 36.4727C30.498 36.2421 30.6382 36.1317C30.898 35.9239C31.1749 35.694 31.2802 35.6044 31.3848 35.5132C31.5556 35.3631 31.6261 35.299C31.7948 35.1446 31.9656 34.9844C32.1514 34.8072C32.2809 34.6798C32.4603 34.4997C32.6574 34.2976 32.8382 34.1062C33.0118 33.9175 33.0965 33.8229C33.2353 33.6663 33.3101 33.5802C33.5186 33.3339C33.7955 32.9973C34.0652 32.6528C34.3278 32.3019C34.5834 31.9453C34.8303 31.5831C35.0695 31.2151C35.3008 30.8414C35.4979 30.5076C35.7022 30.1461C35.9043 29.7696C36.1022 29.3817C36.3257 28.9176C36.5869 28.3319C36.7136 28.0337C36.8296 27.7447C37.7947 25.2892 38.2844 22.6829 38.2844 19.9975C38.2844 17.3121 37.7947 14.7058 36.8296 12.2503L36.831 12.2517Z" fill="#57A16C"/>
            </svg>
          </div>
          <div>Set in <b>Newsreader</b>, <b>Playfair Display Italic</b> &amp; <b>Menlo</b></div>
          <div>&copy; <b>YouVersion</b> &nbsp;·&nbsp; MMXXVI</div>
        </footer>

      </div>
    </div>
  );
}
