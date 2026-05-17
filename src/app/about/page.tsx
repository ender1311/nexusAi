import Link from "next/link";
import { Header } from "@/components/layout/header";

const RED = "#E63946";

const LOOP = [
  { n: "01", k: "Scatter",      v: "Seeds reach soils — every variant gets tested in every persona, weighted by what's already grown." },
  { n: "02", k: "Sow",          v: "POST /api/decide picks a variant for a user. Thompson sampling balances new ground with proven fields." },
  { n: "03", k: "Harvest",      v: "Conversion events flow back. Goal weights become yield. Each soil's record gets richer." },
  { n: "04", k: "Bear fruit",   v: "PersonaArmStats shifts traffic toward seeds that bear fruit. Next season starts with knowledge." },
];

const VOCAB = [
  ["Sower Agent",     "Agent",               "The optimization campaign — e.g. \"Streak Recovery Push\""],
  ["Seed",            "MessageVariant",       "Body, subject, CTA, channel"],
  ["Sowing",          "decideForUser()",      "POST /api/decide selects and sends a variant"],
  ["Soil",            "Persona",             "User cluster — arm stats tracked per persona"],
  ["Yield",           "reward",              "Conversion event × goal weights"],
  ["Scattering",      "Exploration",         "Thompson sampling draws from uncertain arms"],
  ["Bearing fruit",   "Exploitation",        "PersonaArmStats shifts traffic toward what grows"],
  ["Field",           "PersonaArmStats",     "The accumulated knowledge of every soil"],
  ["The next season", "/api/ingest/events",  "Events update stats and shape the next decision"],
];

const FEATURES = [
  { i: "◇", t: "No more A/B picking",           d: "The bandit picks the winner mid-flight. Allocations shift toward what's working in real time." },
  { i: "◷", t: "No more send-time guessing",     d: "Per-user send-time prediction picks the open window. Quiet hours respected automatically." },
  { i: "◉", t: "No more channel stitching",      d: "Push, email, in-app — Sower routes each user to the channel they actually engage on." },
  { i: "◈", t: "No more cohort surgery",         d: "Personas are inferred from behavior, not hand-built. New cohorts appear as patterns emerge." },
  { i: "▲", t: "No more guardrail anxiety",      d: "Set a churn floor and a revenue ceiling. Sower steers within them or stops itself." },
  { i: "⌘", t: "No more analytics scavenger hunt", d: "Every decision is logged with the arm, persona, reward, and the model's reasoning." },
];

const COMPARISON = [
  ["Picks the winning message",         "Eyeball it",     "If/then tree",      "Bandit, in flight"],
  ["Adapts when behavior shifts",       "Next quarter",   "When you rewrite",  "Within hours"],
  ["Personalises per user",             "By segment",     "By segment",        "Per user, per moment"],
  ["Logs every decision",               "Spreadsheet",    "Partial",           "Structured, queryable"],
  ["Respects guardrails automatically", "—",              "Manual checks",     "Hard caps + auto-pause"],
  ["Ramps from 0 → production",         "Months",         "Weeks",             "Same day"],
];

const VARIANTS = [
  { n: "Empathy · We saved your spot.",    reward: 0.81, sends: 412, win: true },
  { n: "Milestone · 7 days. Keep going.",  reward: 0.62, sends: 398, win: false },
  { n: "Question · What stayed with you?", reward: 0.40, sends: 204, win: false },
  { n: "Urgency · Don't lose your streak.", reward: 0.74, sends: 380, win: false },
];

export default function AboutPage() {
  return (
    <>
      <Header title="About Sower" description="What it is, how it works, and why it exists" />

      {/* Page shell with dotted background */}
      <div className="relative overflow-auto">
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            backgroundImage: `radial-gradient(#D8D5D5 1px, transparent 1px)`,
            backgroundSize: "22px 22px",
            opacity: 0.5,
          }}
        />

        <div className="relative z-10">

          {/* ── Hero — split ──────────────────────────────────────────── */}
          <section className="px-4 sm:px-16 pt-12 sm:pt-24 pb-12 sm:pb-20 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-18 items-center">
            <div>
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs text-muted-foreground bg-muted/50"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: RED }} />
                Persona-aware bandit · now in production
              </div>
              <h1
                className="mt-6 font-semibold leading-[1.05] tracking-tight text-4xl sm:text-5xl lg:text-[64px] lg:leading-[1.02]"
                style={{ letterSpacing: "-0.035em" }}
              >
                Send the right message<br />
                to the right person,<br />
                <span className="text-muted-foreground">every time.</span>
              </h1>
              <p className="mt-6 text-base sm:text-lg leading-relaxed text-muted-foreground max-w-lg">
                Sower replaces broadcast sends with a learning loop. Write the messages — Sower decides
                who gets which one, watches what works, and steers the next round toward what bears fruit.
              </p>
              <div className="mt-8 pt-8 border-t flex gap-6 sm:gap-10 flex-wrap">
                {[["+34%", "lift vs broadcast"], ["2.4M", "decisions / month"], ["28", "seeds in rotation"]].map(
                  ([n, l]) => (
                    <div key={l}>
                      <div className="text-2xl font-semibold tracking-tight">{n}</div>
                      <div className="text-xs text-muted-foreground mt-1">{l}</div>
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Product mock */}
            <div className="relative">
              <div className="rounded-xl border bg-card shadow-2xl overflow-hidden">
                {/* Browser bar */}
                <div className="flex items-center gap-2 px-3.5 py-3 border-b bg-muted/30">
                  <div className="flex gap-1.5">
                    {["#FF6058", "#FFBD2E", "#28C940"].map((c) => (
                      <div key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                    ))}
                  </div>
                  <div className="flex-1 text-center text-xs font-mono text-muted-foreground">
                    sower.youversion.com / agent / streak-recovery
                  </div>
                </div>
                <div className="p-6">
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">AGENT · LIVE</div>
                      <div className="text-lg font-semibold mt-1">Streak Recovery Push</div>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: "rgba(74,174,103,0.12)", color: "#4AAE67" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#4AAE67" }} />
                      Bearing fruit
                    </div>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    {VARIANTS.map((v, i) => (
                      <div
                        key={i}
                        className="grid gap-3 items-center px-3.5 py-3 border-t first:border-t-0"
                        style={{ gridTemplateColumns: "1fr 80px 64px 48px" }}
                      >
                        <div className="text-sm flex items-center gap-2">
                          {v.win && <span style={{ color: RED }}>★</span>}
                          <span className={v.win ? "font-semibold" : ""}>{v.n}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${v.reward * 100}%`, background: v.win ? RED : "#A0A0A0" }}
                          />
                        </div>
                        <div className="text-xs font-mono text-muted-foreground text-right">{v.reward.toFixed(2)}</div>
                        <div className="text-xs font-mono text-muted-foreground text-right">{v.sends}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between mt-3.5 text-[11px] font-mono text-muted-foreground">
                    <span>● 312 decisions / sec</span>
                    <span>α/(α+β) · last 14d · n=2,419</span>
                  </div>
                </div>
              </div>

              {/* Floating callouts */}
              <div className="absolute -top-4 -right-5 px-3.5 py-2.5 bg-card border rounded-xl shadow-lg text-xs">
                <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">Soil match</div>
                <div className="font-semibold mt-1">Streak Builder</div>
              </div>
              <div className="absolute -bottom-4 -left-4 px-3.5 py-2.5 bg-card border rounded-xl shadow-lg text-xs">
                <div className="text-[10px] font-mono tracking-widest uppercase text-muted-foreground">Yield</div>
                <div className="font-semibold mt-1" style={{ color: RED }}>+34% lift</div>
              </div>
            </div>
          </section>

          {/* ── Integration logos ─────────────────────────────────────── */}
          <section className="px-4 sm:px-16 pb-10 sm:pb-16">
            <p className="text-[11px] font-mono tracking-widest uppercase text-muted-foreground text-center mb-5">
              Plays nicely with your stack
            </p>
            <div className="flex flex-wrap justify-around items-center py-6 border-y gap-4">
              {["Braze", "Iterable", "Twilio", "Segment", "Snowflake", "Amplitude"].map((n) => (
                <span key={n} className="text-base sm:text-lg font-semibold text-muted-foreground/60 tracking-tight">{n}</span>
              ))}
            </div>
          </section>

          {/* ── Feature grid ─────────────────────────────────────────── */}
          <section className="px-4 sm:px-16 pb-12 sm:pb-24">
            <div className="max-w-3xl mb-8 sm:mb-12">
              <div className="text-[11px] font-mono tracking-widest uppercase mb-3" style={{ color: RED }}>WHAT IT DOES</div>
              <h2 className="text-2xl sm:text-4xl font-semibold tracking-tight leading-tight">
                Six things you stop doing the day Sower goes live.
              </h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map((f) => (
                <div key={f.t} className="p-7 bg-card border rounded-xl">
                  <div className="w-9 h-9 rounded-lg bg-muted grid place-items-center text-lg" style={{ color: RED }}>
                    {f.i}
                  </div>
                  <div className="text-lg font-semibold mt-5 tracking-tight">{f.t}</div>
                  <div className="text-sm text-muted-foreground leading-relaxed mt-2">{f.d}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── How it works ─────────────────────────────────────────── */}
          <section className="px-4 sm:px-16 py-12 sm:py-20 bg-muted/30 border-y">
            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-8 lg:gap-16">
              <div>
                <div className="text-[11px] font-mono tracking-widest uppercase mb-3" style={{ color: RED }}>HOW IT WORKS</div>
                <h2 className="text-2xl sm:text-4xl font-semibold tracking-tight leading-tight">Four moves, on a loop.</h2>
                <p className="text-sm text-muted-foreground leading-relaxed mt-5">
                  Sower never stops learning. Each decision sharpens the next, so the longer it runs,
                  the better it gets at finding the right message for each person.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                {LOOP.map((s) => (
                  <div
                    key={s.n}
                    className="grid gap-6 px-7 py-6 bg-card border rounded-xl items-center"
                    style={{ gridTemplateColumns: "56px 1fr" }}
                  >
                    <div className="text-sm font-mono font-semibold tracking-wider" style={{ color: RED }}>{s.n}</div>
                    <div>
                      <div className="text-lg font-semibold tracking-tight">{s.k}</div>
                      <div className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{s.v}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ── Vocabulary table ─────────────────────────────────────── */}
          <section className="px-4 sm:px-16 py-12 sm:py-24">
            <div className="mb-8 sm:mb-12">
              <div className="text-[11px] font-mono tracking-widest uppercase mb-3" style={{ color: RED }}>VOCABULARY</div>
              <h2 className="text-2xl sm:text-4xl font-semibold tracking-tight leading-tight">The language of the field.</h2>
            </div>
            <div className="w-full overflow-x-auto">
              <div className="min-w-[480px]">
              <div
                className="grid gap-4 sm:gap-8 py-3.5 border-b text-[11px] font-mono tracking-widest uppercase text-muted-foreground"
                style={{ gridTemplateColumns: "1.2fr 1.4fr 2fr" }}
              >
                <div>Sower vocabulary</div>
                <div>In the codebase</div>
                <div>Meaning</div>
              </div>
              {VOCAB.map(([s, c, m]) => (
                <div
                  key={s}
                  className="grid gap-4 sm:gap-8 py-5 sm:py-6 border-b items-baseline"
                  style={{ gridTemplateColumns: "1.2fr 1.4fr 2fr" }}
                >
                  <div className="text-xl sm:text-2xl font-semibold italic tracking-tight">{s}</div>
                  <div className="text-sm font-mono" style={{ color: RED }}>{c}</div>
                  <div className="text-sm text-muted-foreground leading-relaxed">{m}</div>
                </div>
              ))}
              </div>
            </div>
          </section>

          {/* ── Comparison table ─────────────────────────────────────── */}
          <section className="px-4 sm:px-16 pb-12 sm:pb-24">
            <div className="text-center mb-8 sm:mb-12">
              <div className="text-[11px] font-mono tracking-widest uppercase mb-3" style={{ color: RED }}>WHY SWITCH</div>
              <h2 className="text-2xl sm:text-4xl font-semibold tracking-tight leading-tight">Sower vs. how we do it now.</h2>
            </div>
            <div className="border rounded-xl overflow-hidden max-w-5xl mx-auto overflow-x-auto">
              <div className="min-w-[480px]">
              <div
                className="grid px-4 sm:px-6 py-3 sm:py-4 bg-muted/50 border-b text-[11px] font-mono tracking-widest uppercase text-muted-foreground"
                style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr" }}
              >
                <div>Capability</div>
                <div>Manual sends</div>
                <div>Rule-based</div>
                <div style={{ color: RED }}>Sower</div>
              </div>
              {COMPARISON.map(([cap, a, b, c]) => (
                <div
                  key={cap}
                  className="grid px-4 sm:px-6 py-4 sm:py-5 border-t items-center text-sm"
                  style={{ gridTemplateColumns: "1.4fr 1fr 1fr 1fr" }}
                >
                  <div className="font-medium">{cap}</div>
                  <div className="text-muted-foreground">{a}</div>
                  <div className="text-muted-foreground">{b}</div>
                  <div className="font-medium flex items-center gap-2">
                    <span style={{ color: RED }}>✓</span>
                    {c}
                  </div>
                </div>
              ))}
              </div>
            </div>
          </section>

          {/* ── Live preview / API example ──────────────────────────── */}
          <section className="px-4 sm:px-16 pb-12 sm:pb-24">
            <div
              className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-8 lg:gap-12 p-6 sm:p-14 bg-card border rounded-2xl items-center"
            >
              <div>
                <div className="text-[11px] font-mono tracking-widest uppercase mb-3" style={{ color: RED }}>LIVE PREVIEW</div>
                <h2 className="text-3xl font-semibold tracking-tight leading-snug">
                  Watch the bandit pick a message in real time.
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mt-5">
                  An interactive sandbox lets you toggle personas, edit seeds, and see the allocator
                  shift weight as fake conversion events stream in.
                </p>
              </div>
              <div className="bg-muted/50 rounded-lg px-5 py-5 font-mono text-xs leading-7 border">
                <div className="text-muted-foreground">$ curl -X POST sower.api/decide</div>
                <div>→ user_id: <span style={{ color: RED }}>&quot;u_84219&quot;</span></div>
                <div>→ persona: <span style={{ color: RED }}>&quot;streak_builder&quot;</span></div>
                <div className="text-muted-foreground mt-2">{"// allocator drew arm with α=14, β=4"}</div>
                <div>← <span style={{ color: "#4AAE67" }}>variant</span>: &quot;empathy&quot;</div>
                <div>← subject: &quot;We saved your spot.&quot;</div>
                <div>← channel: &quot;push&quot;</div>
                <div>← scheduled_at: &quot;2026-05-05T07:14Z&quot;</div>
                <div className="text-muted-foreground mt-2">{"// 2.3 hours later"}</div>
                <div>← <span style={{ color: "#4AAE67" }}>event</span>: &quot;session_started&quot;</div>
                <div>← reward: 1.0 &nbsp; goal_weighted: 0.81</div>
              </div>
            </div>
          </section>

          {/* ── Stats strip ──────────────────────────────────────────── */}
          <section className="px-4 sm:px-16 pb-12 sm:pb-24">
            <div className="grid grid-cols-2 sm:grid-cols-4 border rounded-xl overflow-hidden bg-card divide-x divide-y sm:divide-y-0">
              {[
                ["+34%", "lift over broadcast",       "weighted, last 30d"],
                ["2.4M", "decisions / month",          "across 4 production agents"],
                ["12",   "behavioral personas",        "auto-clustered, weekly"],
                ["6.84%","avg conversion",             "up from 5.2% baseline"],
              ].map(([n, l, s]) => (
                <div key={l} className="px-6 sm:px-8 py-7 sm:py-9">
                  <div className="text-5xl font-semibold tracking-tight leading-none">{n}</div>
                  <div className="text-sm font-medium mt-3">{l}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s}</div>
                </div>
              ))}
            </div>
          </section>

          {/* ── CTA band ─────────────────────────────────────────────── */}
          <section className="px-16 py-24 bg-[#121212] text-white">
            <div className="flex justify-between items-center gap-12">
              <div className="max-w-2xl">
                <div className="text-[11px] font-mono tracking-widest uppercase mb-3" style={{ color: RED }}>
                  READY WHEN YOU ARE
                </div>
                <h2 className="text-5xl font-semibold tracking-tight leading-none mt-3">Stop sowing blind.</h2>
                <p className="text-base text-white/70 mt-5 max-w-lg leading-relaxed">
                  Pick a goal, write a few seeds, point Sower at a campaign. Within a day you&apos;ll see
                  which seeds are growing in which soils.
                </p>
              </div>
              <div className="flex gap-3 shrink-0">
                <Link
                  href="/demo"
                  className="px-5 py-3.5 rounded-lg border border-white/25 text-sm font-medium hover:bg-white/5 transition-colors"
                >
                  Try the sandbox
                </Link>
                <Link
                  href="/agents/new"
                  className="px-5 py-3.5 rounded-lg text-sm font-semibold text-white transition-colors"
                  style={{ background: RED }}
                >
                  Create an agent →
                </Link>
              </div>
            </div>
          </section>

          {/* ── Footer ───────────────────────────────────────────────── */}
          <footer className="px-16 py-8 border-t bg-muted/30 flex justify-between text-xs font-mono text-muted-foreground">
            <span>SOWER · YOUVERSION · INTERNAL · v0.4.2</span>
            <span>nx-2026.05 · thompson-v3</span>
          </footer>

        </div>
      </div>
    </>
  );
}
