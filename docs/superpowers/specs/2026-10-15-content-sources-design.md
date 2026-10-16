# Content sources: design (Spec A)

**Date:** 2026-10-15
**Status:** approved in conversation, section by section.
**Related:** `2026-10-13-pluggable-martech-stack-design.md` (this adds a fourth port next to DataSource, IngestTranslator and Activator); Spec B, `2026-10-15-nexus-demo-walkthrough-design.md`.

## 1. Goal

Each client chooses where message content comes from:
- **Nexus library:** what exists today.
- **Headless CMS:** Contentful first, with Sanity and a generic JSON endpoint as fallbacks.
- **Braze Catalogs.**

The bandit engine stays unchanged.

## 2. Decisions

| Topic | Decision |
|---|---|
| Arms | Still `MessageVariant.id`. Every source materialises its items as `MessageVariant` rows. |
| Sources | `nexus-library`, `contentful`, `sanity`, `generic-json`, `braze-catalog` |
| Per-client setting | Before P1: one `AppSetting` key, `content_source_config` (JSON, non-secret), plus env-var secrets. It is read only through `getContentSourceConfig()`, so P1 can swap it for per-workspace `Connection`s without changing any caller. |
| Activation | Inline (copy in the payload) for every source. `braze-catalog` also adds a reference (`catalog_item_id`) in trigger or Canvas properties for content cards, slideups and modals. |
| Editing | Synced variants are read-only in Nexus and link back to their source. Editors edit at the source. |
| Failure | A failing source never blocks sends. The last-synced variants stay active. |

## 3. Data model

New columns on `MessageVariant`. The migration is additive: hand-written SQL with `IF NOT EXISTS`, like the repo's other migrations.
- `contentSource TEXT NOT NULL DEFAULT 'nexus-library'`
- `externalRef TEXT NULL`
- `syncedAt TIMESTAMPTZ NULL`
- a unique index on `("contentSource", "externalRef")` where `"externalRef" IS NOT NULL`

New column on `Message`: `contentSource TEXT NOT NULL DEFAULT 'nexus-library'`. A library `Message` belongs to one source.

New table `ContentSyncRun`:
`id, source, startedAt, finishedAt, status ('ok'|'partial'|'failed'), created, updated, archived, skipped, errors JSONB (≤ 50 entries of { externalRef, message })`

## 4. Shared pure module: `src/lib/content-core/`

This module has no DB, network or env access, and no `Date.now()`. That is the same purity rule as `src/lib/engine`.

- `contentItemSchema` (Zod) and its type `ContentItem`:
  ```ts
  type ContentItem = {
    externalRef: string;
    channel: "push" | "email" | "content_card" | "slideup" | "modal";
    title?: string; subject?: string; body?: string; cta?: string;
    deeplink?: string; imageUrl?: string; htmlBody?: string;
    tags: string[];
    locales?: Record<string, { title?: string; body?: string; subject?: string }>;
    updatedAt: string;
  };
  ```
- `FieldMapping = Partial<Record<keyof ContentItem, string>>`. Values are dot paths, with `[]` for arrays and `[*]` for "all values" (for example `"metadata.tags[*].sys.id"`).
- `applyFieldMapping(record: unknown, mapping: FieldMapping, defaults: { channel }): { item?: ContentItem; error?: string }`
- `DEFAULT_MAPPINGS: Record<"contentful" | "sanity" | "generic-json", FieldMapping>`
- `buildActivationProperties(variant: { contentSource; externalRef; title; body; … }, mode: "inline" | "reference"): Record<string, string>`. This returns the trigger or Canvas property bag. Reference mode adds `catalog_item_id` next to the copy.
- `brazeCatalogLiquid(catalogName: string): string`. This returns the template snippet shown in the docs and the demo.

## 5. The ContentSource port: `src/connectors/content/`

```ts
interface ContentSource {
  id: ContentSourceId;
  activation: "inline" | "reference";
  testConnection(): Promise<{ ok: true; sample: ContentItem[] } | { ok: false; error: string }>;
  listItems(cursor?: string): Promise<{ items: ContentItem[]; skipped: { externalRef: string; error: string }[]; next?: string }>;
}
```

| Adapter | API | Pagination | Default mapping |
|---|---|---|---|
| `contentful` | `GET https://cdn.contentful.com/spaces/{space}/environments/{env}/entries?content_type={type}&locale=*`, bearer `CONTENTFUL_DELIVERY_TOKEN` | `skip` / `limit` (100) | `fields.title`, `fields.body`, `fields.cta`, `fields.deeplink`, `fields.image` (resolved through `includes.Asset`), `metadata.tags[*].sys.id`. Locales come from the `fields.*` locale maps. |
| `sanity` | `GET https://{project}.api.sanity.io/v2025-02-19/data/query/{dataset}?query={groq}`, bearer `SANITY_READ_TOKEN` (optional for public datasets) | GROQ slice `[$from...$to]` | `title`, `body`, `cta`, `deeplink`, `image.asset->url`, `tags` |
| `generic-json` | `GET {url}`, optional bearer `GENERIC_CONTENT_TOKEN` | configured as either `cursor` (response path to the next cursor plus a query param) or `page` | none. The mapping is required. |
| `braze-catalog` | `GET {BRAZE_REST_ENDPOINT}/catalogs/{name}/items`, bearer `BRAZE_API_KEY` | `Link: <…>; rel="next"` header | `id` → `externalRef`, plus configurable item fields |
| `nexus-library` | none (no-op) | none | none |

The adapter registry is `CONTENT_SOURCES: Record<ContentSourceId, (config) => ContentSource>`.

## 6. Sync

`syncContentSource(id)`:
1. Pages through `listItems`.
2. Upserts each item into `MessageVariant` on `(contentSource, externalRef)`, under the library `Message` for that source and channel, creating it if missing.
3. Writes locales into `MessageVariantTranslation`.
4. Sets `status = 'archived'` on variants of that source that are not seen in this run. It never deletes them.
5. Records a `ContentSyncRun`.

Overlapping runs for one source are prevented with a Postgres advisory lock on the source id.

**Triggers:**
- **Vercel cron** `GET /api/cron/content-sync` with `CRON_SECRET`. It runs every 15 minutes on Pro. On the Hobby plan, which is what the demo deployment uses, it runs daily, and webhooks plus "Sync now" cover the gap.
- **"Sync now"** in the settings UI: `POST /api/content/sync/[source]`, admin only.
- **Webhooks:** `POST /api/content/webhook/[source]`. Contentful and Sanity webhooks are verified with HMAC-SHA256 over the raw body, using `CONTENT_WEBHOOK_SECRET` and constant-time compare. A valid webhook triggers a sync of that source. A bad signature returns 401.

## 7. Activation

`send-grouping` reads the variant's `contentSource` and asks `buildActivationProperties` for the property bag.

- `inline` sources and every `/messages/send` channel (push, email): byte-identical to today. The P0 characterization snapshots must not change.
- `braze-catalog` on content cards, slideups and modals: the bag adds `catalog_item_id`. The Braze template may render from the catalog: `{% catalog_items {name} {{api_trigger_properties.catalog_item_id}} %}`.

## 8. Settings UI

**Settings → Content sources** (admin only):
- an on/off switch for each source;
- each source's non-secret config: space, environment and content type; project and dataset; URL and pagination mode; catalog name;
- a field-mapping editor, pre-filled with `DEFAULT_MAPPINGS`;
- **Test connection**, which maps and previews the first 3 items;
- **Sync now**;
- the last 10 `ContentSyncRun`s.

Secrets are never shown. The page shows only "token set ✓/✗" from env presence.

Each library page shows a **Source** badge per variant. Synced variants are read-only and link back to the source entry: Contentful web app URL, Sanity studio URL, or none for generic JSON and catalogs.

## 9. API contracts

Every route follows the repo contract: `{ data } | { error }`, explicit status codes, Zod at the boundary, and no internal error text in responses.

New routes:
- `GET/PUT /api/settings/content-sources`
- `POST /api/content/test/[source]`
- `POST /api/content/sync/[source]`
- `GET /api/content/sync-runs`
- `POST /api/content/webhook/[source]`
- `GET /api/cron/content-sync`

## 10. Testing

- **Unit (`content-core`):**
  - field mapping (dot paths, arrays, missing fields, type coercion);
  - default mappings against fixtures;
  - activation property bags in both modes;
  - Liquid snippet.
- **Contract (`tests/contracts/content-sources/`):** each adapter against recorded fixtures (`tests/fixtures/content/{contentful,sanity,generic,braze-catalog}/*.json`) with a `FakeFetch`. Covers:
  - pagination to the end;
  - locales;
  - malformed items skipped with their `externalRef`;
  - auth headers;
  - `testConnection` both passing and failing.
- **Integration (`nexus_test`):** sync creates, updates and archives; it is idempotent; the advisory lock blocks an overlapping run; and each route's shape and auth.
- **Regression:** the P0 snapshots stay byte-identical. A new snapshot covers reference-mode content-card and canvas payloads.
- **Webhook:** a valid HMAC triggers a sync; a bad or missing signature returns 401.
- **Live check, manual, during deploy:** a sandbox Contentful space (Dan to provide), and a Braze catalog if one is available.

## 11. Out of scope

- Writing back to the CMS.
- Per-item arm features from tags (a later LinUCB enhancement).
- Rich-text rendering beyond plain text and HTML passthrough.
- Workspace-scoped config, which comes with P1.

## 12. Open items

- Sandbox credentials: a Contentful space and delivery token. Optional: a Sanity project and a Braze catalog name.
- Whether the demo deployment moves to Vercel Pro for the 15-minute cron. Until it does, the cron runs daily, with webhooks and "Sync now" covering the gap.
