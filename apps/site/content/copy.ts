export const COPY = {
  hero: {
    title: "AI decisioning for the stack you already have.",
    subtitle:
      "Nexus picks the right message, channel and time for each user, then learns from every send. Plugs into your CDP, your warehouse and your ESP. Pay for the lift you can measure.",
    primary: "Try the simulator",
    secondary: "Become a design partner",
    proof: "Built and proven in production with a top consumer app.",
  },
  how: [
    { title: "Connect your data", body: "Point Nexus at your CDP or warehouse. It copies only the fields you map." },
    { title: "Set a goal and variants", body: "Pick the conversion you care about and write a few messages. Nexus handles the rest." },
    { title: "Nexus decides, sends, learns", body: "Each user gets the message most likely to work, through your ESP. Every outcome makes the next decision better." },
  ],
  algorithms: [
    { name: "Thompson sampling", body: "Balances trying new messages with sending proven ones." },
    { name: "Epsilon-greedy", body: "Simple and predictable: mostly the leader, sometimes a test." },
    { name: "LinUCB", body: "Contextual. Learns what works for each kind of user." },
  ],
  provenance: "Every decision is logged with why it was made.",
  comparison: {
    title: "Why not your ESP's built-in AI?",
    rows: [
      { label: "Works with", nexus: "Any CDP, warehouse and ESP", them: "One ESP" },
      { label: "Pricing", nexus: "Per agent, or on measured lift", them: "Per use case, enterprise contracts" },
      { label: "Transparency", nexus: "Every decision explained", them: "Black box" },
      { label: "Proof", nexus: "Holdout lift report built in", them: "Varies" },
    ],
    footnote: "Compared with ESP-native decisioning add-ons in general.",
  },
  offer: {
    title: "Become a design partner",
    terms: "5 spots. 90-day pilot, free. One agent, holdout reports at day 30/60/90. In exchange: a case study and feedback.",
    after: "After the pilot: from $1.5k/mo per agent, or pay on measured lift.",
  },
  console: {
    title: "Explore the full console",
    body: "See the agents, personas and decision logs Nexus runs on, loaded with synthetic data.",
    cta: "Open the demo console",
  },
  faq: [
    { q: "What data does Nexus copy?", a: "Only the fields you map for decisioning. Everything else stays in your systems." },
    { q: "Can we self-host?", a: "Yes. Nexus runs as a single workspace in your own cloud." },
    { q: "Which ESPs work today?", a: "Braze is live, with Hightouch for data. The rest of the list on this page is on the roadmap, and design partners decide the order." },
    { q: "How is lift measured?", a: "A random holdout gets the same messages without decisioning. We report the difference at day 30, 60 and 90." },
  ],
} as const;
