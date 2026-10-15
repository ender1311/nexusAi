export const COPY = {
  hero: {
    title: "AI decisioning for the stack you already have.",
    subtitle:
      "Nexus picks the right message, channel and time for each user, then learns from every send. Live today with Braze, with Hightouch for your data — more connectors on the roadmap. Pay for the lift you can measure.",
    primary: "Try the simulator",
    secondary: "Become a design partner",
    proof: "Built and proven in production with a top consumer app.",
  },
  how: [
    { title: "Sync your data", body: "Send user data in through Hightouch. Warehouse and CDP connectors are on the roadmap." },
    { title: "Set a goal and variants", body: "Pick the conversion you care about and write a few messages. Nexus handles the rest." },
    { title: "Nexus decides, sends, learns", body: "Each user gets the message most likely to work, sent through Braze today. Every outcome makes the next decision better." },
  ],
  algorithms: [
    { name: "Thompson sampling", body: "Balances trying new messages with sending proven ones." },
    { name: "Epsilon-greedy", body: "Simple and predictable: mostly the leader, sometimes a test." },
    { name: "LinUCB", body: "Contextual. Learns what works for each kind of user." },
  ],
  provenance: "Every decision is logged with the variant chosen and the user context it was chosen on, and is inspectable in the Nexus console.",
  comparison: {
    title: "Why not your ESP's built-in AI?",
    rows: [
      { label: "Works with", nexus: "Braze and Hightouch today; more on the roadmap", them: "Usually their own ESP only" },
      { label: "Pricing", nexus: "Per agent, or on measured lift", them: "Often per use case, on enterprise contracts" },
      { label: "Transparency", nexus: "Every decision logged and inspectable", them: "Often limited" },
      { label: "Proof", nexus: "Lift vs. a random-split control, reported during the pilot", them: "Varies" },
    ],
    footnote: "A general comparison with ESP-native decisioning add-ons; individual products differ.",
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
    { q: "What data does Nexus copy?", a: "Only the fields you choose to sync. You control the columns in your Hightouch sync." },
    { q: "Can we self-host?", a: "Not yet. Nexus is hosted for you today. Self-hosting is on the roadmap, and design partners can discuss a private deployment." },
    { q: "Which ESPs work today?", a: "Braze is live, with Hightouch for data. The rest of the list on this page is on the roadmap, and design partners decide the order." },
    { q: "How is lift measured?", a: "Against a random-split control: a share of users get a randomly chosen message instead of Nexus's pick. We report the difference at day 30, 60 and 90 during the pilot." },
  ],
} as const;
