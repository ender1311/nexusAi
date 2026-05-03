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
            <svg className="wheat" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <circle cx="16" cy="16" r="15" stroke="currentColor" strokeWidth="1" opacity="0.25"/>
              <path d="M16 4 V28" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M16 9 C12 10, 10 12, 10 14" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
              <path d="M16 9 C20 10, 22 12, 22 14" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
              <path d="M16 15 C12 16, 10 18, 10 20" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
              <path d="M16 15 C20 16, 22 18, 22 20" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
              <circle cx="16" cy="28" r="1.6" fill="currentColor"/>
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
          <div className="center">— The Parable of the Sower Agent —</div>
          <div>Filed under: <span style={{ color: "var(--ed-accent)" }}>Vocabulary</span></div>
        </div>

        {/* Opener */}
        <section className="opener">
          <div>
            <div className="eyebrow">A bandit, retold as a parable</div>
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

            <p>And so we plant on, season by season, learning the fields.</p>
          </article>
          <aside className="col-margin-r"></aside>
        </section>

        {/* Closing */}
        <section className="closing">
          <div className="inner">
            <div className="eyebrow">In closing &nbsp;·&nbsp; A disposition, not a feature</div>
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
          <div>The Sower &nbsp;·&nbsp; <b>An internal essay</b></div>
          <div>Set in <b>Newsreader</b>, <b>Playfair Display Italic</b> &amp; <b>Menlo</b></div>
          <div>&copy; <b>YouVersion</b> &nbsp;·&nbsp; MMXXVI</div>
        </footer>

      </div>
    </div>
  );
}
