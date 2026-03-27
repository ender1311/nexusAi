# Nexus — Architecture Documentation

Mermaid diagrams for AI agents and developers to understand how the system works.

## Documents

| File | What it covers |
|------|---------------|
| [system-overview.md](./system-overview.md) | High-level architecture: all systems, integrations, and how they connect |
| [data-model.md](./data-model.md) | Full ER diagram of all Prisma DB models + JSON field schemas |
| [bandit-engine.md](./bandit-engine.md) | Thompson Sampling & Epsilon-Greedy algorithms, reward calculation, arm update flow |
| [data-flows.md](./data-flows.md) | Sequence diagrams for all 5 key operations (ingest, reward loop, variant selection, persona discovery, settings) |
| [api-routes.md](./api-routes.md) | All REST endpoints, HTTP methods, request/response shapes, auth |
| [persona-discovery.md](./persona-discovery.md) | K-Means++ clustering, 37-dim feature vector, cosine similarity, engagement buckets |
| [braze-integration.md](./braze-integration.md) | Braze client, payload factory, analytics fetch, graceful degradation |

## Quick Reference

### What is Nexus?
A **multi-armed bandit optimization platform** for personalizing Braze messages (push/email/SMS)
across user personas. It learns which message variant performs best for each user segment and
continuously improves via conversion event feedback.

### Key Data Flow (one sentence each)

1. **Hightouch → `/api/ingest/users`** — syncs user profiles from the data warehouse
2. **Hightouch → `/api/ingest/events`** — streams conversion events, triggers reward update
3. **Bandit engine** — selects the best variant per user×persona via Thompson Sampling or ε-greedy
4. **`/api/personas/discover`** — clusters users into personas via K-Means++ on 37-dim feature vectors
5. **Braze** — receives send payloads built by `PayloadFactory`, delivers messages

### Stack
- **Framework:** Next.js 16 App Router, React 19, TypeScript
- **Database:** Prisma v7 + libsql (SQLite), file: `prisma/dev.db`
- **Styling:** Tailwind CSS v4 + shadcn/ui
- **Charts:** Recharts
- **ML:** Pure TypeScript (Thompson Sampling, K-Means++, Cosine Similarity)
- **External:** Braze (delivery), Hightouch (data sync)
