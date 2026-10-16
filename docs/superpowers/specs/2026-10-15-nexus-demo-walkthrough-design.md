# Nexus demo walkthrough: design (Spec B)

**Date:** 2026-10-15
**Status:** approved in conversation.
**URL:** `beaconfrontier.com/nexus/demo`, a route in `apps/site`. No new zone is needed.
**Depends on:** Spec A, `2026-10-15-content-sources-design.md`, specifically the pure module `src/lib/content-core/`.

## 1. Goal

A guided, interactive story of the whole loop, Hightouch → Nexus → your content → Braze → learning, for a fictional brand. Its purpose is to show a prospect how Nexus fits their stack, and above all their content source, without showing any YouVersion content.

## 2. Decisions

| Topic | Decision |
|---|---|
| Brand | Fictional: "Lumen", a wellness app. No YouVersion name, content or numbers. The existing copy test bans them. |
| Content source | A 3-way switch: Headless CMS (Contentful, Sanity, generic JSON), Braze Catalog, Nexus library. It changes steps 3 and 5. |
| Real vs. illustrative | Payloads come from the real shared code: `@engine/*` for decisions and `@content-core/*` for mapping and activation. The sample data is fictional and labelled "sample". |
| Status labels | Connectors carry `status` from `content/connectors.ts`. The content sources are added as `live` once Spec A ships, and as `roadmap` until then. |
| Import boundary | `apps/site` may import `@engine/*` and `@content-core/*` only. Widen the ESLint rule and the tsconfig paths to match. |

## 3. Steps

1. **Hightouch → Nexus.** A sample warehouse row for one Lumen user (days active, sessions, last open hour, plan, locale), shown as the Hightouch sync record and the `POST /api/ingest/users` body.
2. **Features and persona.** The engine computes the user's 10-dimensional feature vector (`computeFeatureVector` with a fixed `asOf`). The step shows the vector as labelled bars and the nearest of 4 sample personas.
3. **Content source.** The switch picks one view:
   - **Contentful:** a sample entry (JSON), the default mapping, and the resulting `ContentItem` from `applyFieldMapping`;
   - **Sanity** and **generic JSON:** the same, with their own sample records and mappings;
   - **Braze Catalog:** a sample catalog item mapped to a `ContentItem`;
   - **Nexus library:** a library variant.
4. **The agent decides.** Four sample content items are the arms. The real Thompson engine, seeded so the step is deterministic, picks one for this user, with the estimate ± 95% interval for each arm.
5. **Nexus → Braze.** The API call for the chosen item, from `buildActivationProperties`:
   - **Inline** (CMS and library): the copy sits in the trigger properties.
   - **Reference** (Braze Catalog): `catalog_item_id` sits next to the copy, plus the Liquid snippet from `brazeCatalogLiquid`.
   - A push-channel toggle shows the `/messages/send` inline shape.
6. **Outcome → learning.** "User converted" or "No conversion" buttons update that arm's Beta stats and show the before/after.

**Navigation:** a step rail (1–6), Next/Back buttons, deep links (`/nexus/demo?step=3&source=contentful`), and keyboard arrow keys. At the end: "Become a design partner" (to `/nexus#design-partner`) and "Back to the simulator".

## 4. Code layout (`apps/site`)

- `app/demo/page.tsx`: a server component holding the page shell and metadata, with canonical `/nexus/demo`.
- `components/demo/walkthrough.tsx`: the client component that holds step and source state, synced to URL search params.
- `components/demo/steps/step-{1..6}-*.tsx`: one file per step.
- `content/demo-lumen.ts`: all sample data (user row, personas, CMS entries, catalog items, library variants).
- `lib/demo/build-step-data.ts`: pure functions that combine sample data with `@engine` and `@content-core` to produce what each step shows. All tests target this module.
- A link from the main page: in "How it works", add "See the full loop step by step →" pointing to `/nexus/demo`.

## 5. Testing

- **Unit (`build-step-data`):**
  - step 2's vector is deterministic, and the persona is the nearest one;
  - each source's step 3 output passes `contentItemSchema`;
  - step 4 is deterministic for its seed;
  - step 5's reference mode includes `catalog_item_id` and inline mode doesn't;
  - step 6 updates the Beta stats correctly.
- **Component:** URL deep links restore the step and source; Next and Back respect the bounds.
- **Copy rules:** the existing all-source scan covers the new files. Add "Lumen" sample-data labels to the honesty check: the text "sample" must appear on steps 1, 3 and 5.
- **Smoke:** extend the Playwright production spec to open `/nexus/demo`, step to 5 with source=braze-catalog, and assert that `catalog_item_id` is visible.

## 6. Out of scope

- Connecting a visitor's own CMS.
- Any real Lumen API.
- Animations beyond simple transitions.
