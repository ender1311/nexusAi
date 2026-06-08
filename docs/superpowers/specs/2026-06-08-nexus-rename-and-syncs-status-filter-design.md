# Bundle 1: Sower→Nexus copy cleanup + Syncs status filter — Design

**Date:** 2026-06-08
**Status:** Approved

Two small, low-risk UI changes shipped together as one branch/MR.

---

## Part A — Rename product "Sower" → "Nexus" (keep the parable)

The product was formerly named "Sower" and is now "Nexus". All copy that uses
"Sower" as the **product name** must read "Nexus". All copy that uses the
**parable-of-the-sower metaphor** (sow, sowing, seed, soil, scatter, harvest,
bear fruit, field, yield) stays — that reference is intentional and approved.

### `src/app/faq/page.tsx`

- L10: `q: "What is Nexus (Sower)?"` → `q: "What is Nexus?"`

### `src/app/about/page.tsx`

Product-name occurrences to change to "Nexus":

| Line | Current | New |
|------|---------|-----|
| L32  | "…Sower routes each user…" | "…Nexus routes each user…" |
| L34  | "Sower steers within them…" | "Nexus steers within them…" |
| L109 | `title="About Sower"` | `title="About Nexus"` |
| L142–143 | "Sower replaces broadcast sends… Sower decides…" | "Nexus replaces broadcast sends… Nexus decides…" |
| L166 | `sower.youversion.com / agent / streak-recovery` | `nexus.youversion.com / agent / streak-recovery` |
| L238 | "…the day Sower goes live." | "…the day Nexus goes live." |
| L261 | "Sower never stops learning." | "Nexus never stops learning." |
| L318 | "Sower vs. how we do it now." | "Nexus vs. how we do it now." |
| L329 | comparison column header "Sower" | "Nexus" |
| L366 | `$ curl -X POST sower.api/decide` | `$ curl -X POST nexus.api/decide` |
| L403 | "point Sower at a campaign" | "point Nexus at a campaign" |
| L427 | footer `SOWER · YOUVERSION · INTERNAL · v0.4.2` | `NEXUS · YOUVERSION · INTERNAL · v0.4.2` |

### KEEP unchanged (parable / metaphor)

- LOOP steps L10–15 (Scatter / Sow / Harvest / Bear fruit)
- VOCAB metaphor terms (Seed, Sowing, Soil, Yield, Scattering, Bearing fruit, Field, The next season)
- L401 CTA "Stop sowing blind." (deliberate wordplay)
- **L18 vocab term `"Sower Agent"`** — the parable's name for an Agent (inside the metaphor table). *Approved: keep.*
- **L295 table header `"Sower vocabulary"`** — labels the metaphor column. *Approved: keep.*

### Guard test

`tests/regression/about-faq-product-name.test.tsx` — render `AboutPage` / FAQ
content and assert:
- About `<Header>` title is "About Nexus"
- First FAQ question is "What is Nexus?"

Prevents silent copy regression. (About page does a DB read via `unstable_cache`;
the test asserts on the static `title`/FAQ data, mocking/avoiding the DB call.)

---

## Part B — Syncs table status filter

**File:** `src/components/data-ingest/syncs-table.tsx`

Status **sort** already exists (`STATUS_SORT_ORDER`, `toggleSort("status")`).
Only a status **filter** is missing.

### Behavior

- New state: `statusFilter: Set<string>` (empty set = show all).
- Render a data-driven row of toggleable status pills derived from the statuses
  actually present in `syncs`, each showing a count, e.g. `Failed 3`,
  `Warning 1`, `Success 42`. Order pills by `STATUS_SORT_ORDER` (failed first).
- Multi-select, OR semantics: clicking a pill toggles it in/out of the set;
  multiple selected pills show the union. An "All" pill (active when the set is
  empty) clears the filter.
- Apply inside the existing `filtered` useMemo, composing with the existing
  Nexus-only + search filters and the sort:
  ```ts
  if (statusFilter.size > 0) list = list.filter((s) => statusFilter.has(s.status));
  ```
- Counts on the pills reflect the data **after** the Nexus-only + search filters
  (so they match what the user is currently scoped to), computed before the
  status filter is applied.
- The existing `{filtered.length} of {syncs.length}` summary stays.
- Same `filtered` list feeds both the desktop table and the mobile cards, so the
  filter works on both with no extra wiring.

### Test

`tests/regression/syncs-table-status-filter.test.tsx` (happy-dom) — render
`SyncsTable` with mixed-status mock syncs, click the "Failed" pill, assert only
failed-status rows remain; click it again (or "All"), assert all rows return.

---

## Out of scope (separate future designs)

- Mobile bottom-tab "fan" subpage navigation.
- DB-backed sync rename with Hightouch-id integrity.
