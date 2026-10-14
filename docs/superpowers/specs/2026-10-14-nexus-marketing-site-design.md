# Nexus marketing site: design

**Date:** 2026-10-14
**URL:** `beaconfrontier.com/nexus`
**Goal:** book design-partner calls.

## 1. Decisions

| Topic | Decision |
|---|---|
| Primary goal | Book design-partner calls. There is no self-serve sign-up. |
| Demo | (1) An interactive simulator on the page, running the real engine in the browser, as the centrepiece. (2) A secondary "Explore the full console" link to `nexus-ai-demo-dl.vercel.app`, loaded with synthetic data. |
| Code location | `apps/site` inside the nexusAi repo. It imports `src/lib/engine/*` directly, with no copies. |
| Hosting | A new Vercel project, `nexus-site` (team Dan's projects, root `apps/site`, `basePath: "/nexus"`), mounted on beaconfrontier.com as a zone, the same way as `/book`. |
| Booking | A short qualifying form, then a Calendly embed. |
| Lead email | Resend sends from `nexus@beaconfrontier.com` to `LEAD_NOTIFY_EMAIL=danluk1311@gmail.com`. |
| Proof | No YouVersion name, user counts or results until YouVersion agrees (see the IP item in the pluggable spec §12.6). The site says only "built and proven in production with a top consumer app". |
| Competitors | The category is described generically ("ESP-native decisioning add-ons"). No named competitor and no competitor prices. |

## 2. The page (one scroll)

1. **Hero.** "AI decisioning for the stack you already have." Subhead: "Nexus picks the right message, channel and time for each user, then learns from every send. Plugs into your CDP, your warehouse and your ESP. Pay for the lift you can measure." Buttons: **Try the simulator** (scrolls down) and **Become a design partner** (opens the form).
2. **Stack strip.** Sources: Segment, Snowflake, BigQuery, Hightouch, webhook/CSV. Senders: Braze, Iterable, Customer.io, OneSignal, Twilio, SendGrid. Connectors are listed in `apps/site/content/connectors.ts` with a `status: "live" | "roadmap"` field, and roadmap ones are labelled "on the roadmap". Today only Braze and Hightouch are `live`.
3. **Simulator** (§3).
4. **How it works.** Three steps: connect data → set a goal and variants → Nexus decides, sends through your ESP and learns. Then a plain-language explainer of Thompson, epsilon-greedy and LinUCB, and "every decision is logged with why it was made".
5. **Why not your ESP's built-in AI.** A comparison table: locked to one ESP vs. vendor-neutral; per-use-case enterprise pricing vs. per agent or on lift; black-box vs. reasoning shown.
6. **Design-partner offer.** "5 spots. 90-day pilot, free. One agent, holdout reports at day 30/60/90. In exchange: a case study and feedback." "After the pilot: from $1.5k/mo per agent, or pay on measured lift."
7. **Explore the full console.** A link to the demo app.
8. **FAQ and footer.** Data handling (Nexus copies only mapped fields), self-hosting, the ESPs supported today.

All copy lives in `apps/site/content/*.ts`, so it can change without touching components.

## 3. Simulator

- **Inputs:**
  - data source and sender dropdowns: these change labels and the animated flow diagram only, never the maths;
  - a use-case preset: *Win back lapsed users*, *Onboarding day 1–7*, *Upsell to paid*;
  - an algorithm: Thompson (default), epsilon-greedy, LinUCB.
- **Run:**
  - about 5,000 simulated users over 30 simulated days, in about 20 seconds;
  - controls: pause, speed (1×/2×/4×), reset, replay;
  - a seeded RNG, so replay is identical.
- **Presets.** Each preset has 4 variants with fixed true conversion rates, shown behind a "Show the hidden truth" toggle and labelled "simulated". *Upsell to paid* has 3 user segments, each with a different best variant, so LinUCB has something to learn.
- **Live outputs:**
  - traffic share per variant;
  - cumulative lift vs. a 10% holdout;
  - regret vs. the best variant;
  - on the segmented preset, a per-segment best-variant view;
  - a "Why this decision?" ticker, e.g. "user 1832 → variant B: estimated conversion 6.1% ± 0.8%".
- **Code:**
  - `apps/site/lib/simulator/`: a pure loop (`simulate(preset, algorithm, seed) → stepwise state`) that imports `ThompsonSampling`, `EpsilonGreedy` and `LinUCB` from the engine. The engine's `Math.random` calls go through the seeded RNG by swapping `Math.random` for the run, the same technique as the P0 characterization tests.
  - The UI is a client component that consumes the loop.
  - Charts use Recharts. There are no network calls.
- **Out of scope for v1:** visitor-entered rates.

## 4. Leads

- **Form fields:** work email, company, data source (select + "other"), sender (select + "other"), use case to pilot (text, ≤ 280 chars). Plus a hidden honeypot field.
- **`POST /nexus/api/leads`:**
  - Zod validation, then 400 on bad input;
  - a honeypot hit returns 200 and stores nothing;
  - a per-IP rate limit of 5 per hour returns 429;
  - responses follow the repo contract: `{ data }` or `{ error }`.
- **Storage:** Prisma model `DesignPartnerLead { id, email, company, source, sender, useCase, createdAt, userAgent }` in `nexus-demo-db`. The table is created by an idempotent SQL file, `apps/site/db/001_design_partner_lead.sql`, applied with psql.
- **Email:** Resend sends from `nexus@beaconfrontier.com` to `LEAD_NOTIFY_EMAIL`. A failed email is logged; the lead is still saved and the visitor still gets the calendar.
- **After submit:** the Calendly inline embed (`NEXT_PUBLIC_CALENDLY_URL=https://calendly.com/danluk1311/30min`), pre-filled with name and email.
- **Env (`nexus-site` project):** `DATABASE_URL` (the `nexus-demo-db` integration), `RESEND_API_KEY`, `LEAD_NOTIFY_EMAIL`, `NEXT_PUBLIC_CALENDLY_URL`.

## 5. Routing and headers

- **beaconfrontier repo (`business-name-generator`):**
  - add `nexusZoneRewrites()` to `src/lib/zones.ts`, mirroring `bookZoneRewrites`, with `NEXUS_SITE_ORIGIN`;
  - wire it into `next.config.ts` `beforeFiles`;
  - add `nexus` to the `OWN_PATHS` lookahead.
- **`apps/site`:** sends its own CSP. Allowed origins: self, `assets.calendly.com`, `calendly.com` (frame and script), Vercel Analytics.
- **DNS:** Resend's domain records for `beaconfrontier.com`, added on Vercel DNS. Leave the existing SES MX untouched.

## 6. Synthetic console data

`scripts/seed-demo-synthetic.ts` fills `nexus-demo-db` with:
- 4 agents: Thompson, epsilon-greedy, LinUCB, and one with a holdout;
- 3–4 variants each;
- about 2,000 users across the 12 mock personas;
- 6 weeks of decisions and conversions, with lift curves.

**Safety:** the script refuses to run unless the database host matches the demo endpoint (`ep-orange-star-b8ujtvot`), and it never reads `.env.local`. It is idempotent: it truncates its own rows and reseeds. It uses no YouVersion content.

## 7. Boundaries

- `apps/site` may import only `src/lib/engine/**`. ESLint `no-restricted-imports` enforces this.
- The engine stays pure. If the simulator needs a hook in the engine (for example, injectable randomness), add it as a backward-compatible optional parameter, with tests.

## 8. Testing

- **Unit (`apps/site/tests/`):**
  - Thompson traffic converges to the true best variant by day 30 on each preset;
  - LinUCB beats Thompson on cumulative reward on the segmented preset;
  - holdout lift is within the expected range;
  - a replay with the same seed is byte-identical.
- **Integration:** `/api/leads` handles valid input, bad input (400), a honeypot hit (200, nothing stored), and the rate limit (429). Resend is mocked.
- **Smoke (Playwright against the deployed URL):** `/nexus` loads, the simulator runs to day 30, and the form submits and shows Calendly.

## 9. Out of scope (v1)

Sign-up, a pricing page, visitor-entered rates, A/B testing the site itself, and analytics beyond Vercel Analytics.

## 10. Open items

- Move `LEAD_NOTIFY_EMAIL` to a `@beaconfrontier.com` inbox once SES forwarding is confirmed.
- YouVersion permission before any named proof.
