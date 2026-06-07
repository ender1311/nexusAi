# Sidebar Navigation Skeleton (Sub-project A) — Design

**Date:** 2026-06-07
**Status:** Approved
**Part of:** Comprehensive sidebar reorganization (A = nav skeleton; B = Audience › Search Users; C = Audience › Segments + Sizes). This spec covers **A only**.

## Goal

Replace the flat 13-item sidebar with a collapsible, nested navigation tree. Pure information-architecture restructure plus placeholder routes for pages built in B and C. No page business logic changes.

## Information Architecture

Top-level order is **primary-first** (daily-use items high, docs low).

| Group | Type | Children → route |
|---|---|---|
| **Dashboard** | group | Overview → `/` · Control Tower → `/control-tower` |
| **Agents** | link | `/agents` |
| **Audience** | group | Search Users → `/audience/search` · Segments → `/audience/segments` · Sizes → `/audience/sizes` *(placeholders)* |
| **Content** | group | Push Library → `/messages` · Email Library → `/email-library` *(placeholder)* · Verse Library → `/push-library` |
| **Data** | group | Personas → `/personas` · Performance → `/performance` · Data Ingest → `/data-ingest` |
| **About** | group | About → `/about` · Architecture → `/architecture` · Advanced Docs → `/demo/deep-dive` · FAQ → `/faq` · Demo → `/demo` |
| **Settings** | link | `/settings` |

**Invariant:** every page reachable in today's sidebar remains reachable. No 404s.

### Route notes
- `/messages` is the push **template** library (today labelled "Push Library").
- `/push-library` is the campaign **verse** content library → relabelled "Verse Library" under Content.
- `/data-ingest` (Hightouch ingest status) → nested under Data.
- New placeholder routes created in A: `/audience/search`, `/audience/segments`, `/audience/sizes`, `/email-library`.

## Architecture

### `src/components/layout/nav-config.ts` (new, pure data)
Typed nav tree, no JSX logic:
```ts
type NavItem = { href: string; label: string; icon: LucideIcon };
type NavGroup = { label: string; icon: LucideIcon; children: NavItem[] };
type NavEntry = NavItem | NavGroup; // discriminate via "children" in entry
export const navTree: NavEntry[] = [ ... ];
```
Components are dumb consumers; the tree is unit-testable in isolation.

### `src/components/layout/sidebar.tsx` (rewrite)
- Renders `navTree`. Top-level `NavItem`s render as links (as today). `NavGroup`s render a chevron header that expands/collapses an indented child list.
- **Active route** auto-expands its parent group. Uses the existing "most-specific match wins" longest-prefix logic, extended to nested children, so `/demo/deep-dive` highlights "Advanced Docs" (not "Demo").
- **Expanded state** persists to `localStorage` (key e.g. `nexus.nav.expanded`). On first load, the group containing the active route is expanded.
- **Full-rail collapse** (`w-16` icon rail) preserved. In rail mode only group/link icons show; clicking a group icon expands the rail and that group.

### `src/components/layout/sidebar.tsx` — MobileNav
Update the 5 bottom-tab destinations to: Dashboard `/`, Agents `/agents`, Audience `/audience/search`, Content `/messages`, About `/about` (or FAQ).

### Placeholder pages (4)
`/audience/search`, `/audience/segments`, `/audience/sizes`, `/email-library`: minimal Server Components using the existing `Header` + a centered "Coming soon" card. No DB access. Replaced by B and C.

## Testing

- **`tests/regression/nav-config.test.ts`** — asserts the tree contains every currently-reachable top-level destination (guard against silently dropping a page), all hrefs unique, group/child shapes valid.
- **`tests/regression/sidebar-nav.test.tsx`** (happy-dom) — renders sidebar; groups expand/collapse on click; active route highlights + auto-expands parent; nested deep route (`/demo/deep-dive`) highlights the correct child.
- **Placeholder smoke test** — each new placeholder page mounts without error.

## Out of scope (deferred to B / C)
- Search Users data + messaging history (B).
- Segment builder, SQL sizing, Sizes overview, "flatten data fields" decision (C). Note: live sample shows 34.6M users with ~41 sparse Hightouch attribute keys → C will use a curated field catalog, not full column flattening.
