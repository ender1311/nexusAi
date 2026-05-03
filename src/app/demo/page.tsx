"use client";

import {
  Cpu,
  Target,
  Smartphone,
  Send,
  Eye,
  Check,
  Clock,
  Zap,
  Brain,
  Activity,
  Moon,
  TrendingUp,
  Headphones,
  Sun,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";

// ─── Color palette ─────────────────────────────────────────────────────────────
const STEP_COLORS = [
  "bg-[#57a16c]",
  "bg-purple-500",
  "bg-teal-500",
  "bg-green-500",
  "bg-orange-500",
  "bg-[#57a16c]",
];

// ─── Feature vector data ────────────────────────────────────────────────────────
const CHANNEL_COLORS = ["bg-blue-400", "bg-green-400", "bg-yellow-400"];
const HOURLY_COLORS = Array.from({ length: 24 }, (_, i) =>
  i >= 19 && i <= 21 ? "bg-[#57a16c]" : "bg-muted-foreground/30"
);
const DAILY_COLORS = Array.from({ length: 7 }, () => "bg-purple-400");
const EXTRA_COLORS = ["bg-orange-400", "bg-pink-400", "bg-indigo-400"];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function StepHeader({
  step,
  title,
  subtitle,
  isLast = false,
}: {
  step: number;
  title: string;
  subtitle: string;
  isLast?: boolean;
}) {
  const color = STEP_COLORS[step - 1];
  return (
    <div className="flex gap-4 mb-6">
      <div className="flex flex-col items-center">
        <div
          className={`w-10 h-10 rounded-full ${color} text-white flex items-center justify-center text-sm font-bold shrink-0`}
        >
          {step}
        </div>
        {!isLast && <div className="w-0.5 flex-1 bg-border mt-2" />}
      </div>
      <div className="pt-1 pb-8">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

function BetaCurve({
  alpha,
  beta,
  sample,
  highlight,
}: {
  alpha: number;
  beta: number;
  sample: number;
  highlight: boolean;
}) {
  const mode = (alpha - 1) / (alpha + beta - 2);
  const sigma = 1 / Math.sqrt(alpha + beta);

  const points: string[] = [];
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    const z = (x - mode) / sigma;
    const y = Math.exp(-0.5 * z * z);
    const px = 10 + i * 1.4;
    const py = 55 - y * 48;
    points.push(`${px},${py}`);
  }
  const polyline = points.join(" ");
  const sampleX = 10 + sample * 140;

  return (
    <svg
      width="160"
      height="64"
      className={`rounded border ${highlight ? "border-[#57a16c] bg-[#57a16c]/5" : "border-border bg-muted/30"}`}
    >
      <polyline
        points={polyline}
        fill="none"
        stroke={highlight ? "#57a16c" : "hsl(var(--muted-foreground))"}
        strokeWidth="2"
      />
      <line
        x1={sampleX}
        y1="8"
        x2={sampleX}
        y2="56"
        stroke={highlight ? "#57a16c" : "hsl(var(--muted-foreground))"}
        strokeWidth="1.5"
        strokeDasharray="3,2"
      />
      <text x={sampleX + 3} y="16" fontSize="8" fill={highlight ? "#57a16c" : "hsl(var(--muted-foreground))"}>
        {sample.toFixed(2)}
      </text>
    </svg>
  );
}

function PhoneMockup() {
  return (
    <div className="flex justify-center">
      <div className="relative w-52 bg-gray-900 rounded-[2.5rem] p-3 shadow-2xl border-4 border-gray-700">
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-5 bg-gray-900 rounded-b-xl z-10" />
        {/* Status bar */}
        <div className="flex justify-between px-3 pt-4 pb-1 text-gray-400 text-[8px]">
          <span>9:41</span>
          <span>●●●</span>
        </div>
        {/* Screen */}
        <div className="bg-gray-800 rounded-2xl min-h-[260px] p-2 space-y-2">
          {/* Wallpaper hint */}
          <div className="h-16 bg-gradient-to-br from-gray-700 to-gray-800 rounded-xl" />
          {/* Push notification card — YouVersion/Holy Bible style */}
          <div className="bg-white rounded-2xl p-3 text-gray-900 shadow-lg border border-gray-100">
            <div className="flex items-start gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="https://air-prod.imgix.net/836ed311-f54b-4463-a1f4-b1628a91ca30.jpg?w=97&h=97&fm=png&fit=crop"
                alt="Bible App"
                className="w-10 h-10 rounded-[10px] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1 mb-0.5">
                  <p className="text-[11px] font-bold text-gray-900 leading-tight">
                    Great job! 👏
                  </p>
                  <span className="text-[9px] text-gray-500 shrink-0">now</span>
                </div>
                <p className="text-[10px] text-gray-800 leading-snug">
                  You&apos;re doing amazing! Continue your whole Bible Plan ➡️
                </p>
              </div>
            </div>
          </div>
        </div>
        {/* Home indicator */}
        <div className="flex justify-center mt-2">
          <div className="w-20 h-1 bg-gray-600 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function FlywheelDiagram() {
  const muted = "hsl(var(--muted-foreground))";
  const border = "hsl(var(--border))";

  return (
    <div className="flex justify-center w-full overflow-visible">
      <svg
        viewBox="0 0 360 260"
        className="w-full max-w-md"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker id="flywheel-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
            <path d="M0,0 L0,8 L8,4 z" fill={muted} />
          </marker>
        </defs>

        {/* Center: AI decisioning loop */}
        <text x="180" y="128" textAnchor="middle" fontSize="12" fontWeight="600" fill={muted}>
          AI decisioning loop
        </text>

        {/* Top: Nexus */}
        <rect x="140" y="8" width="80" height="36" rx="8" fill="#8b5cf6" fillOpacity="0.15" stroke="#8b5cf6" strokeWidth="2" />
        <text x="180" y="30" textAnchor="middle" fontSize="11" fontWeight="700" fill="#8b5cf6">Nexus</text>

        {/* Right: Marketing automation platform */}
        <rect x="268" y="88" width="84" height="36" rx="8" fill="#f97316" fillOpacity="0.15" stroke="#f97316" strokeWidth="2" />
        <text x="310" y="105" textAnchor="middle" fontSize="9" fontWeight="600" fill="#f97316">Marketing</text>
        <text x="310" y="116" textAnchor="middle" fontSize="9" fontWeight="600" fill="#f97316">automation</text>

        {/* Bottom: Identified customers */}
        <rect x="140" y="216" width="80" height="36" rx="8" fill="#22c55e" fillOpacity="0.15" stroke="#22c55e" strokeWidth="2" />
        <text x="180" y="236" textAnchor="middle" fontSize="10" fontWeight="600" fill="#22c55e">Identified</text>
        <text x="180" y="247" textAnchor="middle" fontSize="10" fontWeight="600" fill="#22c55e">customers</text>

        {/* Left: Warehouse or CDP */}
        <rect x="8" y="88" width="84" height="36" rx="8" fill="#a855f7" fillOpacity="0.15" stroke="#a855f7" strokeWidth="2" />
        <text x="50" y="105" textAnchor="middle" fontSize="9" fontWeight="600" fill="#a855f7">Warehouse</text>
        <text x="50" y="116" textAnchor="middle" fontSize="9" fontWeight="600" fill="#a855f7">or CDP</text>

        {/* Arrows with labels */}
        {/* Nexus → Marketing automation */}
        <path d="M 180 44 L 180 70 L 268 106" fill="none" stroke={border} strokeWidth="1.5" markerEnd="url(#flywheel-arrow)" />
        <text x="200" y="75" fontSize="8" fill={muted}>Daily customer-level</text>
        <text x="200" y="84" fontSize="8" fill={muted}>decisions</text>

        {/* Marketing automation → Identified customers */}
        <path d="M 310 124 L 310 170 L 180 216" fill="none" stroke={border} strokeWidth="1.5" markerEnd="url(#flywheel-arrow)" />
        <text x="280" y="155" fontSize="8" fill={muted}>Communications</text>

        {/* Identified customers → Warehouse or CDP */}
        <path d="M 180 216 L 50 124" fill="none" stroke={border} strokeWidth="1.5" markerEnd="url(#flywheel-arrow)" />
        <text x="100" y="185" fontSize="8" fill={muted}>Interactions</text>

        {/* Warehouse or CDP → Nexus */}
        <path d="M 50 106 L 50 70 L 140 44" fill="none" stroke={border} strokeWidth="1.5" markerEnd="url(#flywheel-arrow)" />
        <text x="50" y="55" fontSize="8" fill={muted}>First-party data</text>
        <text x="50" y="64" fontSize="8" fill={muted}>(daily feed)</text>
      </svg>
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function DemoPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-10">
      {/* Hero */}
      <Card className="border-l-4 border-l-[#57a16c]">
        <CardContent className="pt-6">
          <h1 className="text-2xl font-bold mb-1">How Nexus Makes a Decision</h1>
          <p className="text-muted-foreground mb-6">
            Follow one user through the complete pipeline — from raw behavioral data to a
            personalized push notification, and back to the model as a learning signal.
          </p>
          {/* Horizontal stepper */}
          <div className="flex items-center gap-2 flex-wrap">
            {[
              "User Profile",
              "Persona Match",
              "Variant Selection",
              "Message Crafted",
              "Feedback Loop",
              "Flywheel",
            ].map((label, i) => (
              <div key={i} className="flex items-center gap-2">
                <div
                  className={`w-7 h-7 rounded-full ${STEP_COLORS[i]} text-white flex items-center justify-center text-xs font-bold`}
                >
                  {i + 1}
                </div>
                <span className="text-xs font-medium text-muted-foreground hidden sm:inline">
                  {label}
                </span>
                {i < 5 && <div className="h-px w-6 bg-border hidden sm:block" />}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Section 1: User Profile ─────────────────────────────────────── */}
      <div>
        <StepHeader
          step={1}
          title="User Profile Assembled"
          subtitle="Raw behavioral signals are collected and normalized into a feature vector"
        />
        <Card>
          <CardContent className="pt-6 space-y-6">
            {/* Identity */}
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-full bg-[#57a16c]/20 flex items-center justify-center text-[#57a16c] font-bold text-lg shrink-0">
                SC
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-lg">Sarah Chen</span>
                  <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                    user_abc123
                  </code>
                  <div className="flex items-center gap-1 text-xs text-green-600">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                    </span>
                    last active 2 min ago
                  </div>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  <Smartphone className="inline h-3 w-3 mr-1" />
                  iPhone 15 Pro · San Francisco, CA
                </p>
              </div>
            </div>

            <Separator />

            {/* Stats grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Sessions", value: "847", icon: Activity },
                { label: "Day Streak", value: "142", icon: TrendingUp },
                { label: "Conversions", value: "23", icon: Check },
                { label: "Member Since", value: "Mar 2023", icon: Clock },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-lg border p-3 text-center">
                  <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <div className="text-xl font-bold">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            <Separator />

            {/* Channel affinity */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Channel Affinity</h3>
              <div className="space-y-2">
                {[
                  { channel: "Push", pct: 72, color: "bg-blue-500" },
                  { channel: "Email", pct: 45, color: "bg-green-500" },
                  { channel: "SMS", pct: 23, color: "bg-yellow-500" },
                ].map(({ channel, pct, color }) => (
                  <div key={channel} className="flex items-center gap-3">
                    <span className="text-sm w-12">{channel}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-sm font-medium w-9 text-right">{pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Hourly engagement */}
            <div>
              <h3 className="text-sm font-semibold mb-3">
                Hourly Engagement{" "}
                <span className="text-muted-foreground font-normal">(peak: 7–9 PM)</span>
              </h3>
              <div className="flex items-end gap-0.5 h-12">
                {Array.from({ length: 24 }, (_, i) => {
                  const isPeak = i >= 19 && i <= 21;
                  const heights = [
                    2, 1, 1, 1, 1, 2, 5, 8, 7, 6, 5, 5, 6, 5, 4, 4, 5, 6, 7, 9, 10, 8, 5, 3,
                  ];
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-sm ${isPeak ? "bg-[#57a16c]" : "bg-muted-foreground/30"}`}
                      style={{ height: `${heights[i] * 10}%` }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>12am</span>
                <span>6am</span>
                <span>12pm</span>
                <span>6pm</span>
                <span>11pm</span>
              </div>
            </div>

            <Separator />

            {/* Feature vector */}
            <div>
              <h3 className="text-sm font-semibold mb-2">Feature Vector (37 dimensions)</h3>
              <div className="flex flex-wrap gap-0.5 mb-2">
                {CHANNEL_COLORS.map((c, i) => (
                  <div key={i} className={`w-4 h-4 rounded-sm ${c}`} />
                ))}
                <div className="w-px bg-border mx-1" />
                {HOURLY_COLORS.map((c, i) => (
                  <div key={i} className={`w-4 h-4 rounded-sm ${c}`} />
                ))}
                <div className="w-px bg-border mx-1" />
                {DAILY_COLORS.map((c, i) => (
                  <div key={i} className={`w-4 h-4 rounded-sm ${c}`} />
                ))}
                <div className="w-px bg-border mx-1" />
                {EXTRA_COLORS.map((c, i) => (
                  <div key={i} className={`w-4 h-4 rounded-sm ${c}`} />
                ))}
              </div>
              <div className="flex gap-3 text-[10px] text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-blue-400" /> Channel[3]
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-[#57a16c]" /> Hourly[24] (peak lit)
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-purple-400" /> Daily[7]
                </span>
                <span className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm bg-orange-400" /> Rate · Freq · Rew
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 2: Persona Match ────────────────────────────────────── */}
      <div>
        <StepHeader
          step={2}
          title="Persona Match"
          subtitle="The feature vector is compared against learned persona centroids via cosine similarity"
        />
        <Card>
          <CardContent className="pt-6 space-y-6">
            {/* Vector comparison */}
            <div>
              <h3 className="text-sm font-semibold mb-3">User vs. Nearest Centroid</h3>
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">User vector</div>
                  <div className="flex flex-wrap gap-0.5">
                    {[...CHANNEL_COLORS, ...HOURLY_COLORS, ...DAILY_COLORS, ...EXTRA_COLORS].map(
                      (c, i) => (
                        <div key={i} className={`w-3.5 h-3.5 rounded-sm ${c}`} />
                      )
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <div className="flex-1 border-t border-dashed" />
                  <span>cosine similarity → 0.92</span>
                  <div className="flex-1 border-t border-dashed" />
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Evening Engager centroid</div>
                  <div className="flex flex-wrap gap-0.5">
                    {[...CHANNEL_COLORS, ...HOURLY_COLORS, ...DAILY_COLORS, ...EXTRA_COLORS].map(
                      (c, i) => (
                        <div
                          key={i}
                          className={`w-3.5 h-3.5 rounded-sm ${c} opacity-80`}
                        />
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Top 3 personas */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Top Persona Matches</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  {
                    name: "Evening Engager",
                    score: 0.92,
                    icon: Moon,
                    traits: ["Push-first", "7–9 PM peak", "High streak"],
                    winner: true,
                    color: "text-[#57a16c]",
                  },
                  {
                    name: "Morning Devotee",
                    score: 0.71,
                    icon: Sun,
                    traits: ["Email-first", "6–8 AM peak", "Daily habit"],
                    winner: false,
                    color: "text-purple-500",
                  },
                  {
                    name: "Audio Commuter",
                    score: 0.44,
                    icon: Headphones,
                    traits: ["In-app audio", "Commute hours", "Moderate freq"],
                    winner: false,
                    color: "text-teal-500",
                  },
                ].map(({ name, score, icon: Icon, traits, winner, color }) => (
                  <div
                    key={name}
                    className={`rounded-lg border p-4 ${winner ? "ring-2 ring-[#57a16c]" : ""}`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`h-4 w-4 ${color}`} />
                      <span className="text-sm font-semibold">{name}</span>
                      {winner && (
                        <Badge variant="default" className="ml-auto text-[10px] py-0">
                          Best Match
                        </Badge>
                      )}
                    </div>
                    <div className="mb-3">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Similarity</span>
                        <span className="font-medium">{score.toFixed(2)}</span>
                      </div>
                      <Progress value={score * 100} className="h-1.5" />
                    </div>
                    <div className="space-y-1">
                      {traits.map((t) => (
                        <div key={t} className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <div className="w-1 h-1 rounded-full bg-muted-foreground/50" />
                          {t}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Winner bar */}
            <div className="rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 flex items-center gap-3">
              <Check className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <span className="font-semibold text-sm">Evening Engager</span>
                <span className="text-sm text-muted-foreground ml-2">
                  assigned with 92% confidence
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 3: Variant Selection ───────────────────────────────── */}
      <div>
        <StepHeader
          step={3}
          title="Variant Selection"
          subtitle="Thompson Sampling draws from each variant's Beta distribution to pick the best arm"
        />
        <Card>
          <CardContent className="pt-6 space-y-6">
            {/* Variant cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  letter: "A",
                  name: "Daily Verse",
                  body: "Start your day with today's verse — tap to read.",
                  alpha: 22,
                  beta: 10,
                  sample: 0.61,
                  winner: false,
                },
                {
                  letter: "B",
                  name: "Evening Devotional",
                  body: "Your evening devotional is ready — 5 min of calm.",
                  alpha: 38,
                  beta: 8,
                  sample: 0.83,
                  winner: true,
                },
                {
                  letter: "C",
                  name: "Plan Progress",
                  body: "You're 60% through your reading plan — keep going!",
                  alpha: 15,
                  beta: 12,
                  sample: 0.52,
                  winner: false,
                },
                {
                  letter: "D",
                  name: "Community Prompt",
                  body: "3 friends in your group are reading right now.",
                  alpha: 9,
                  beta: 7,
                  sample: 0.48,
                  winner: false,
                },
              ].map(({ letter, name, body, alpha, beta, sample, winner }) => (
                <div
                  key={letter}
                  className={`rounded-lg border p-4 space-y-3 ${winner ? "ring-2 ring-primary" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                        winner ? "bg-[#57a16c] text-white" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {letter}
                    </div>
                    <span className="font-semibold text-sm">{name}</span>
                    {winner && (
                      <Badge className="ml-auto text-[10px] py-0">Selected</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      α={alpha} β={beta} · E[r]={((alpha) / (alpha + beta)).toFixed(2)}
                    </div>
                    <BetaCurve alpha={alpha} beta={beta} sample={sample} highlight={winner} />
                  </div>
                </div>
              ))}
            </div>

            {/* Decision bar */}
            <div className="rounded-lg bg-[#57a16c]/10 border border-[#57a16c]/30 px-4 py-3 flex items-center gap-3">
              <Brain className="h-5 w-5 text-[#57a16c] shrink-0" />
              <div className="flex-1">
                <span className="font-semibold text-sm">EXPLOIT</span>
                <span className="text-sm text-muted-foreground ml-2">
                  Variant B has the most data and was sampled highest (0.83)
                </span>
              </div>
              <Badge variant="outline" className="shrink-0">
                Exploit
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 4: Message Crafted ─────────────────────────────────── */}
      <div>
        <StepHeader
          step={4}
          title="Message Crafted"
          subtitle="Nexus assembles the push payload and sends via Braze with optimal timing"
        />
        <Card>
          <CardContent className="pt-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Phone mockup */}
              <PhoneMockup />

              {/* Payload breakdown */}
              <div className="space-y-3">
                <h3 className="text-sm font-semibold">Payload Breakdown</h3>
                {[
                  {
                    key: "Title",
                    value: "Great job! 👏",
                    reason: "Encouraging variant copy",
                    reasonVariant: "default" as const,
                  },
                  {
                    key: "Channel",
                    value: "Push (iOS)",
                    reason: "72% affinity",
                    reasonVariant: "secondary" as const,
                  },
                  {
                    key: "Send Time",
                    value: "7:58 PM local",
                    reason: "Peak engagement window",
                    reasonVariant: "secondary" as const,
                  },
                  {
                    key: "Deeplink",
                    value: "youversion://devotional/evening",
                    reason: "Evening Engager persona",
                    reasonVariant: "outline" as const,
                  },
                  {
                    key: "Persona",
                    value: "Evening Engager",
                    reason: "Cosine sim 0.92",
                    reasonVariant: "outline" as const,
                  },
                  {
                    key: "Algorithm",
                    value: "Thompson Sampling",
                    reason: "Variant B (0.83)",
                    reasonVariant: "outline" as const,
                  },
                ].map(({ key, value, reason, reasonVariant }) => (
                  <div key={key} className="flex items-start gap-3">
                    <span className="text-xs text-muted-foreground w-20 shrink-0 pt-0.5">{key}</span>
                    <div className="flex-1">
                      <span className="text-xs font-medium">{value}</span>
                    </div>
                    <Badge variant={reasonVariant} className="text-[10px] py-0 shrink-0">
                      {reason}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Sending indicator */}
            <div className="rounded-lg bg-green-500/10 border border-green-500/30 px-4 py-3 flex items-center gap-3">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
              <Send className="h-4 w-4 text-green-600 shrink-0" />
              <span className="text-sm font-medium text-green-800 dark:text-green-400">
                Sending via Braze in &lt; 1 minute
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 5: Feedback Loop ───────────────────────────────────── */}
      <div>
        <StepHeader
          step={5}
          title="Feedback Loop"
          subtitle="User actions flow back as reward signals that update the Beta distributions"
        />
        <Card>
          <CardContent className="pt-6 space-y-6">
            {/* Event timeline */}
            <div>
              <h3 className="text-sm font-semibold mb-4">Event Timeline</h3>
              <div className="space-y-4">
                {[
                  {
                    icon: Send,
                    label: "Sent",
                    time: "7:58 PM",
                    delta: "",
                    color: "text-blue-500",
                    bg: "bg-blue-500/10",
                    highlight: false,
                  },
                  {
                    icon: Eye,
                    label: "Opened",
                    time: "8:00 PM",
                    delta: "+2 min",
                    color: "text-yellow-500",
                    bg: "bg-yellow-500/10",
                    highlight: false,
                  },
                  {
                    icon: Check,
                    label: "Converted — plan_started",
                    time: "8:05 PM",
                    delta: "+5 min",
                    color: "text-green-600",
                    bg: "bg-green-500/10",
                    highlight: true,
                  },
                ].map(({ icon: Icon, label, time, delta, color, bg, highlight }, i) => (
                  <div key={i} className="flex items-center gap-4">
                    <div
                      className={`w-9 h-9 rounded-full ${bg} flex items-center justify-center shrink-0`}
                    >
                      <Icon className={`h-4 w-4 ${color}`} />
                    </div>
                    <div className="flex-1">
                      <span
                        className={`text-sm font-medium ${highlight ? "text-green-700 dark:text-green-400" : ""}`}
                      >
                        {label}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-medium">{time}</div>
                      {delta && (
                        <div className="text-[10px] text-muted-foreground">{delta}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Reward calculation */}
            <div>
              <h3 className="text-sm font-semibold mb-4">Reward Calculation</h3>
              <div className="flex items-center gap-2 flex-wrap">
                {[
                  { label: "Event", value: "plan_started", sub: '"best" tier' },
                  { label: "Calculation", value: "Base 10 × 0.7", sub: "goal weight" },
                  { label: "Raw Reward", value: "7.0 / 100", sub: "normalized" },
                  { label: "Final", value: "Δα = +0.7", sub: "alpha increment" },
                ].map(({ label, value, sub }, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="rounded-lg border px-3 py-2 text-center min-w-[100px]">
                      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        {label}
                      </div>
                      <div className="text-sm font-semibold mt-0.5">{value}</div>
                      <div className="text-[10px] text-muted-foreground">{sub}</div>
                    </div>
                    {i < 3 && (
                      <span className="text-muted-foreground text-lg font-light">→</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Before/After Beta curves */}
            <div>
              <h3 className="text-sm font-semibold mb-4">Beta Distribution Update — Variant B</h3>
              <div className="flex items-center gap-6 flex-wrap">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-2">Before</div>
                  <BetaCurve alpha={38} beta={8} sample={0.83} highlight={false} />
                  <div className="text-xs text-muted-foreground mt-1">Beta(38, 8)</div>
                </div>
                <div className="flex flex-col items-center gap-1 text-muted-foreground">
                  <span className="text-lg">→</span>
                  <span className="text-[10px]">α: 38 → 38.7</span>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground mb-2">After</div>
                  <BetaCurve alpha={38.7} beta={8} sample={0.84} highlight={true} />
                  <div className="text-xs text-muted-foreground mt-1">Beta(38.7, 8)</div>
                </div>
              </div>
            </div>

            {/* Reward tier table */}
            <Separator />
            <div>
              <h3 className="text-sm font-semibold mb-3">Full Reward Tier Map</h3>
              <div className="rounded-lg border overflow-hidden text-xs">
                <table className="w-full">
                  <thead>
                    <tr className="bg-muted/50 text-muted-foreground">
                      <th className="text-left px-3 py-2 font-medium">Event</th>
                      <th className="text-left px-3 py-2 font-medium">Tier</th>
                      <th className="text-right px-3 py-2 font-medium">α change</th>
                      <th className="text-right px-3 py-2 font-medium">β change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[
                      { event: "plan_completed / plan_read_day_7", tier: "best", alpha: "+10", beta: "0", positive: true, attribution: "30-day" },
                      { event: "plan_started / plan_read_day_3", tier: "very_good", alpha: "+7", beta: "0", positive: true, attribution: "30-day" },
                      { event: "bible_opened", tier: "good", alpha: "+5", beta: "0", positive: true, attribution: "48h" },
                      { event: "no conversion within window", tier: "neutral", alpha: "0", beta: "+1", positive: false, attribution: "—" },
                      { event: "push_disabled", tier: "worst", alpha: "0", beta: "+10", positive: false, attribution: "90-day lookback" },
                    ].map(({ event, tier, alpha, beta, positive }) => (
                      <tr key={event} className="hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono text-[11px]">{event}</td>
                        <td className="px-3 py-2">
                          <Badge
                            variant="outline"
                            className={`text-[10px] py-0 ${positive ? "border-green-400 text-green-700" : "border-red-300 text-red-600"}`}
                          >
                            {tier}
                          </Badge>
                        </td>
                        <td className={`px-3 py-2 text-right font-mono ${positive ? "text-green-600" : "text-muted-foreground"}`}>{alpha}</td>
                        <td className={`px-3 py-2 text-right font-mono ${!positive && beta !== "0" ? "text-red-500" : "text-muted-foreground"}`}>{beta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-2 bg-muted/30 text-[10px] text-muted-foreground">
                  * After temporal decay: α = 1 + (α−1)×0.99, β = 1 + (β−1)×0.99 — applied before each update
                </div>
              </div>
            </div>

            <Separator />

            {/* Four learning mechanisms */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Why the System Gets Better Over Time</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  {
                    title: "Pessimistic prior Beta(1, 30)",
                    color: "border-blue-300 bg-blue-500/5",
                    badge: "bg-blue-100 text-blue-700",
                    label: "~3.2% expected reward",
                    body: "Every new variant starts at Beta(1, 30) — 97% chance of non-conversion. This prevents the system from over-exploiting an arm before it has real evidence. Arms must earn trust.",
                  },
                  {
                    title: "Temporal decay ×0.99 per update",
                    color: "border-purple-300 bg-purple-500/5",
                    badge: "bg-purple-100 text-purple-700",
                    label: "prevents winner lock-in",
                    body: "Before each update, α and β decay toward 1 and 30 respectively. A variant that won 3 months ago but has gone stale gradually loses confidence, allowing re-exploration.",
                  },
                  {
                    title: "Persona-segmented arms",
                    color: "border-teal-300 bg-teal-500/5",
                    badge: "bg-teal-100 text-teal-700",
                    label: "independent per cluster",
                    body: "Each persona × agent × variant has its own arm. \"Evening Engager\" users train a completely separate model from \"Morning Devotee\" users — the right message per archetype.",
                  },
                  {
                    title: "push_disabled = hard negative",
                    color: "border-red-300 bg-red-500/5",
                    badge: "bg-red-100 text-red-700",
                    label: "β += 10 across all arms",
                    body: "When a user disables push, all arms in that agent take a −10 penalty across the last 90 days of decisions. The system learns which content leads to opt-outs and suppresses it.",
                  },
                ].map(({ title, color, badge, label, body }) => (
                  <div key={title} className={`rounded-lg border ${color} p-4`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-xs font-semibold leading-tight">{title}</span>
                      <span className={`text-[10px] rounded px-1.5 py-0.5 font-medium shrink-0 ${badge}`}>{label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{body}</p>
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Convergence timeline */}
            <div>
              <h3 className="text-sm font-semibold mb-3">Convergence Timeline</h3>
              <div className="space-y-2">
                {[
                  {
                    period: "Week 1–2",
                    pct: 25,
                    label: "High exploration",
                    desc: "All arms uncertain — system explores broadly. Beta distributions are wide; winners haven't emerged yet.",
                    color: "bg-blue-400",
                  },
                  {
                    period: "Week 3–4",
                    pct: 55,
                    label: "Winners emerge per persona",
                    desc: "Arm distributions narrow. Per-persona winning variants start dominating sends. First measurable lift vs. random.",
                    color: "bg-purple-400",
                  },
                  {
                    period: "Month 2",
                    pct: 80,
                    label: "Convergence",
                    desc: "Exploit ratio climbs above 85%. System confidently selects best arm per persona. Typically 15–30% CTR lift over random baseline.",
                    color: "bg-teal-400",
                  },
                  {
                    period: "Month 3+",
                    pct: 95,
                    label: "Continuous improvement",
                    desc: "Temporal decay keeps the system sensitive to trend shifts. New variants are explored; stale ones fade. The flywheel compounds.",
                    color: "bg-green-500",
                  },
                ].map(({ period, pct, label, desc, color }) => (
                  <div key={period} className="flex items-start gap-3">
                    <div className="w-14 shrink-0 text-right">
                      <span className="text-[10px] text-muted-foreground font-medium">{period}</span>
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%`, maxWidth: "100%" }} />
                      </div>
                      <span className="text-xs font-medium">{label}</span>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Learning summary */}
            <div className="rounded-lg bg-[#57a16c]/10 border border-[#57a16c]/30 px-4 py-3">
              <p className="text-sm">
                <Zap className="inline h-4 w-4 text-[#57a16c] mr-1 -mt-0.5" />
                Next time for <strong>Evening Engager</strong>, Variant B is now{" "}
                <strong>3% more likely</strong> to be selected.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Section 6: The Flywheel ────────────────────────────────────── */}
      <div>
        <StepHeader
          step={6}
          title="The Flywheel"
          subtitle="Each decision makes the system smarter — compounding over thousands of users"
          isLast
        />
        <Card>
          <CardContent className="pt-6 space-y-6">
            {/* Flywheel diagram */}
            <FlywheelDiagram />

            <Separator />

            {/* Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Decisions Made", value: "1,247", icon: Brain },
                { label: "Conversion Rate", value: "4.2% → 8.7%", icon: TrendingUp },
                { label: "Exploit Ratio", value: "88%", icon: Target },
                { label: "Personas Found", value: "12", icon: Cpu },
              ].map(({ label, value, icon: Icon }) => (
                <div key={label} className="rounded-lg border p-3 text-center">
                  <Icon className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
                  <div className="text-lg font-bold">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>

            {/* Conclusion */}
            <div className="rounded-lg bg-muted/50 border px-5 py-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                After <strong className="text-foreground">1,247 decisions</strong>, Nexus has
                learned optimal variants for each persona-channel combination, achieving a{" "}
                <strong className="text-foreground">107% lift</strong> over random assignment. The
                more decisions the system makes, the tighter the Beta distributions become, and the
                more confidently it can exploit the best variant for each user segment.
              </p>
            </div>

            {/* How it works video */}
            <div>
              <h3 className="text-sm font-semibold mb-3">How It Works</h3>
              <div className="rounded-xl overflow-hidden border bg-muted/30">
                <video
                  src="/NexusHowItWorks.mp4"
                  controls
                  className="w-full"
                  playsInline
                  preload="metadata"
                >
                  Your browser does not support the video tag.
                </video>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
