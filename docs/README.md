# Nexus — Architecture Documentation

Reference docs (mostly Mermaid diagrams) for AI agents and developers to
understand how the system works.

## Architecture & data model

| File | What it covers |
|------|---------------|
| [system-overview.md](./system-overview.md) | High-level architecture: all systems, integrations, and how they connect |
| [data-model.md](./data-model.md) | Full ER diagrams of all Prisma DB models + JSON field schemas |
| [data-flows.md](./data-flows.md) | Sequence diagrams for the main operations (ingest, reward loop, variant selection, persona discovery, settings, hourly send) |
| [api-routes.md](./api-routes.md) | All REST endpoints, HTTP methods, request/response shapes, auth |

## Bandit engine & personas

| File | What it covers |
|------|---------------|
| [bandit-engine.md](./bandit-engine.md) | Thompson Sampling, Epsilon-Greedy & LinUCB; reward calculation; per-user blending; arm update + temporal decay |
| [thompson-sampling-model.md](./thompson-sampling-model.md) | Dedicated Thompson Sampling reference: priors, selection, update rules, runtime integration |
| [persona-discovery.md](./persona-discovery.md) | HDBSCAN (default) / k-means clustering, 10-dim feature vector, cosine similarity, engagement buckets |
| [personas.md](./personas.md) | The 8 hand-authored classifier archetypes + how they differ from discovered personas |
| [agent-training-convergence-vision.md](./agent-training-convergence-vision.md) | Forward-looking design: multi-dimensional credit assignment + convergence visibility |

## Sending, targeting & timing

| File | What it covers |
|------|---------------|
| [send-timing-architecture.md](./send-timing-architecture.md) | The hourly `select-and-send` pipeline, per-user send-time computation, quiet hours |
| [nexus-agent-targeting-spec.md](./nexus-agent-targeting-spec.md) | Multi-segment `segmentTargeting` (includes/excludes) semantics |

## Braze & ingest integration

| File | What it covers |
|------|---------------|
| [braze-integration.md](./braze-integration.md) | Braze client, payload factory, analytics fetch, graceful degradation (authoritative for Nexus) |
| [braze-sending-capabilities.md](./braze-sending-capabilities.md) | Braze REST API capability reference (with Nexus deviations called out) |
| [braze-analytics-reward-pipeline.md](./braze-analytics-reward-pipeline.md) | The DB-based analytics decay sweep (backstop to the Currents reward path) |
| [ingest-audiences.md](./ingest-audiences.md) | `POST /api/ingest/audiences` — Braze cohorts → `UserSegment` rows |
| [hightouch-sync-config.md](./hightouch-sync-config.md) | Hightouch destination + sync setup, column mappings, Liquid gotchas |

## Content references

| File | What it covers |
|------|---------------|
| [deeplinks.md](./deeplinks.md) | Verified YouVersion deep-link inventory (also the `Deeplink` model source) |
| [push-copy-inventory.md](./push-copy-inventory.md) | Proven re-engagement push copy variants |

## Ops & status

| File | What it covers |
|------|---------------|
| [production-readiness.md](./production-readiness.md) | Deployment checklist, gap analysis, steps to go live |
| [architecture-audit-2026-05-30.md](./architecture-audit-2026-05-30.md) | Point-in-time architecture audit (historical snapshot) |
| [brain.md](./brain.md) | Early design narrative (historical context) |
| [todo-later.md](./todo-later.md) | Deferred work and ideas |

JSON payload templates live in [`json/`](./json/) (`hightouch-*.json`,
`giving-push-library.json`) as concrete Hightouch Liquid / library examples.

## Quick Reference

### What is Nexus?
A **multi-armed bandit optimization platform** for personalizing Braze messages
(push / email / in-app / content-card) across user personas. It learns which
message variant performs best for each user segment and continuously improves via
conversion-event feedback.

### Key Data Flow (one sentence each)

1. **Hightouch → `/api/ingest/users`** — syncs user profiles from the data warehouse
2. **Hightouch → `/api/ingest/events`** — streams conversion events, triggers reward update
3. **Braze Currents → `/api/ingest/braze-events`** — primary per-user click → reward path
4. **Hourly cron → `/api/cron/select-and-send`** — assigns users, picks variants, schedules sends
5. **Bandit engine** — selects the best variant per user via LinUCB or Thompson/ε-greedy (with per-user blending)
6. **`/api/personas/discover`** — clusters users into personas via HDBSCAN (k-means fallback) on 10-dim feature vectors

### Stack
- **Framework:** Next.js 16 App Router, React 19, TypeScript
- **Database:** Prisma v7 + PostgreSQL (Neon in prod/preview)
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **Charts:** Recharts
- **ML:** Pure TypeScript (Thompson Sampling, LinUCB, HDBSCAN / k-means, cosine similarity)
- **External:** Braze (delivery), Hightouch (data sync)
