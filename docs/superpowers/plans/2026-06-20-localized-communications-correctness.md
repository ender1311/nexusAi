# Localized Communications Correctness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make localized communications resolve correctly for every way agents use them — all channels, cloned variants, and Guided Prayer — not just push.

**Architecture:** Today both per-language translation lookup and VOTD/GP/verse Liquid-tag resolution are gated on `meta.channel === "push"` in `send-grouping.ts` (and `localizeEnabled` requires a push message in the cron). We (1) make resolution channel-agnostic so the existing per-channel payload builders receive localized copy, (2) resolve a clone's translations through its template at send time (single source of truth), and (3) localize Guided Prayer the same way VOTD already works (per-language cache + `versionForLanguage` + localized labels). Missing-translation behavior stays **strict-skip** (decided).

**Tech Stack:** Next.js App Router route handler (`src/app/api/cron/select-and-send/route.ts`), pure grouping lib (`src/lib/cron/send-grouping.ts`), VOTD/GP libs (`src/lib/votd/*`), Prisma v7 + Postgres, Bun test runner.

## Global Constraints

- Missing translation for a non-English user → **skip the user** (strict), never English fallback. (Product decision; `resolvePushLocaleStrict` already does this.)
- Localization applies to **all channels**: push, email, content-card, in-app (slideup), modal-iam, sms.
- No language may ever be mixed within a single Braze API call — preserve `copyKeyed` group-key behavior for every channel.
- Engine/lib changes are pure (no DB/network in `send-grouping.ts`) — unit tests have no DB dependency (`tests/unit/`). Route/migration changes get regression/integration tests (`tests/regression/`, `tests/integration/`).
- **Migration hazard:** `prisma.config.ts` loads `.env.local` (PRODUCTION Neon). `npx prisma migrate dev` runs against prod. The GP-cache migration (Task 5) must be reviewed and run deliberately; do not run it against the local test DB.
- Run `bun run check:quick` after each task; `bun run check` before the final push.

---

### Task 1: Channel-agnostic localized copy in `send-grouping.ts`

**Files:**
- Modify: `src/lib/cron/send-grouping.ts:141-203`
- Test: `tests/unit/send-grouping-localization.test.ts` (extend; create if absent)

**Interfaces:**
- Consumes: existing `groupDecisionsByVariant(inputs, variantMeta, decisionIdByUser, localization?, givingMultiplier?)` signature — unchanged.
- Produces: localized `VariantSendGroup.title/body` for ALL channels (was push-only).

- [ ] **Step 1: Write failing tests** in `tests/unit/send-grouping-localization.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { groupDecisionsByVariant, type VariantMeta } from "@/lib/cron/send-grouping";

const baseMeta = (channel: string): VariantMeta => ({
  channel, body: "Hello", title: "Hi", cta: null, deeplink: null,
  brazeCampaignId: null, brazeVariantId: null, givingHandleStrategy: null, iconImageUrl: null,
});
const user = (lang: string) => ({ externalId: `u-${lang}`, brazeId: null, attributes: { language_tag: lang } });

describe("send-grouping localization is channel-agnostic", () => {
  for (const channel of ["email", "content-card", "in-app", "modal-iam"]) {
    it(`localizes ${channel} copy for a non-English user with a translation`, () => {
      const meta = new Map([["v1", baseMeta(channel)]]);
      const decisionIds = new Map([["u-es", "d1"]]);
      const translations = new Map([["v1", new Map([["es", { title: "Hola", body: "Hola mundo" }]])]]);
      const groups = groupDecisionsByVariant(
        [{ user: user("es"), variantId: "v1", scheduledAt: new Date("2026-06-20T12:00:00Z"), inLocalTime: false }],
        meta, decisionIds,
        { enabled: true, translationsByVariant: translations },
      );
      const g = Object.values(groups)[0];
      expect(g.body).toBe("Hola mundo");
      expect(g.title).toBe("Hola");
    });

    it(`strict-skips ${channel} for a non-English user with NO translation`, () => {
      const meta = new Map([["v1", baseMeta(channel)]]);
      const decisionIds = new Map([["u-es", "d1"]]);
      const groups = groupDecisionsByVariant(
        [{ user: user("es"), variantId: "v1", scheduledAt: new Date("2026-06-20T12:00:00Z"), inLocalTime: false }],
        meta, decisionIds,
        { enabled: true, translationsByVariant: new Map([["v1", new Map()]]) },
      );
      expect(Object.keys(groups)).toHaveLength(0);
    });
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test tests/unit/send-grouping-localization.test.ts`
Expected: FAIL — email/content-card/in-app/modal-iam currently send English `"Hello"` (no skip), so both assertions fail.

- [ ] **Step 3: Remove the `&& meta.channel === "push"` channel gates** in `src/lib/cron/send-grouping.ts`:
  - Line 141: `const isVotd = (localization?.votdVariantIds?.has(variantId) ?? false);` (drop `&& meta.channel === "push"`)
  - Line 142: `const isGp   = (localization?.gpVariantIds?.has(variantId) ?? false);` (drop the gate)
  - Line 192: `} else if (localization?.enabled) {` (drop `&& meta.channel === "push"`)
  - Line 203: `copyKeyed = isVotd || isGp || isVerse || (localization?.enabled ?? false);` (drop the leading `meta.channel === "push" &&`)

- [ ] **Step 4: Generalize dynamic-image resolution** for canvas channels (push + in-app + modal-iam can carry a dynamic image; content-card and email cannot). In `src/lib/cron/send-grouping.ts:217-232`, replace the three `&& meta.channel === "push"` conditions with a shared predicate:

```ts
const imageCapableChannel = meta.channel === "push" || meta.channel === "in-app" || meta.channel === "modal-iam";
if (meta.iconImageUrl === VERSE_IMAGE_SENTINEL) {
  if (votdImage && imageCapableChannel) { iosImageUrl = votdImage.ios; androidImageUrl = votdImage.android; }
  else if (gpImage && imageCapableChannel) { iosImageUrl = gpImage.ios; androidImageUrl = gpImage.android; }
  else if (meta.body === VERSE_PUSH_SENTINEL && imageCapableChannel) {
    const { ios, android } = buildVerseImageUrls(verseImageId ?? DEFAULT_VERSE_IMAGE_ID);
    iosImageUrl = ios; androidImageUrl = android;
  }
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `bun test tests/unit/send-grouping-localization.test.ts`
Expected: PASS (all channels localize; missing translation skips).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cron/send-grouping.ts tests/unit/send-grouping-localization.test.ts
git commit -m "fix(i18n): resolve localized copy + liquid tags on all channels, not just push"
```

---

### Task 2: Load translations + detect VOTD/GP variants for all channels (cron)

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts:921` (localizeEnabled), `:941-955` (VOTD/GP detection), `:1207` & `:1648` (recruitment language gate)
- Test: `tests/integration/cron-localization-channels.test.ts` (create)

**Interfaces:**
- Consumes: `agent.localizePush`, `agent.messages[].channel`, `agent.messages[].variants[]`.
- Produces: `localizeEnabled` true whenever `agent.localizePush` (any channel); `votdVariantIds`/`gpVariantIds` populated from variants on any channel.

- [ ] **Step 1: Make `localizeEnabled` channel-independent.** `route.ts:921`:

```ts
const localizeEnabled = agent.localizePush;
```

- [ ] **Step 2: Detect VOTD/GP tags on every channel.** `route.ts:941-955` — delete the `if (msg.channel !== "push") continue;` line so the inner `hasVotdTags`/`hasGpTags` checks run for all channels.

- [ ] **Step 3: Generalize the recruitment language gate.** At `route.ts:1207` and `:1648`, the term `(hasPushMessages && !localizeEnabled) ? "en" : null` (and `windowHasPush`) forces English-only recruitment only when push is present. Replace `hasPushMessages`/`windowHasPush` in these two expressions with a `hasSendableMessages` boolean (`agent.messages.length > 0`) so an unlocalized email/IAM agent also recruits English-only rather than recruiting non-English users it will then skip. (Locate the existing `hasPushMessages`/`windowHasPush` definitions just above each site and add `const hasSendableMessages = agent.messages.length > 0;` alongside.)

- [ ] **Step 4: Write an integration test** `tests/integration/cron-localization-channels.test.ts` that builds (via `tests/helpers/builders.ts`) an agent with `localizePush: true` and an **email** variant + a `MessageVariantTranslation` (es), assigns one `es` user and one `en` user, runs the select-and-send handler against the test DB with the Braze client stubbed, and asserts the captured email payload for the `es` user carries the Spanish subject/body and the `en` user carries English. (Follow the existing cron integration test setup in `tests/integration/` for stubbing Braze and invoking the route.)

- [ ] **Step 5: Run**

Run: `bun run test:int -- cron-localization-channels`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/integration/cron-localization-channels.test.ts
git commit -m "fix(i18n): enable translation loading + VOTD/GP detection for all channels in cron"
```

---

### Task 3: Resolve a clone's translations through its template (cron)

**Files:**
- Modify: `src/app/api/cron/select-and-send/route.ts:923-933` (translation load), and the `agent.messages.variants` select to include `sourceTemplateId`
- Test: `tests/regression/clone-translation-resolution.test.ts` (create)

**Interfaces:**
- Consumes: `MessageVariant.sourceTemplateId` (clone → template link).
- Produces: `translationsByVariant` keyed by the **clone's own id**, populated from its template's `MessageVariantTranslation` rows when the clone has none of its own.

- [ ] **Step 1: Write the failing regression test** `tests/regression/clone-translation-resolution.test.ts`:

```ts
// Bug: cloned variants had no MessageVariantTranslation rows of their own, so the
// cron looked them up by the clone id, found none, and strict-skipped non-English
// users. Translations live on the template; resolve through sourceTemplateId.
import { describe, it, expect } from "bun:test";
// ... build a template variant with an `es` translation, a clone with sourceTemplateId
// set and NO translations, then assert the resolved translation map for the clone id
// contains the template's `es` copy. (Use the same helper the cron uses — see Step 2.)
```

- [ ] **Step 2: Extract a small helper** `resolveTranslationsByVariant(rows, variants)` next to the cron (or inline) that, after loading `MessageVariantTranslation` for the union of variant ids **and** their non-null `sourceTemplateId`s, returns a `Map<variantId, Map<lang, LocalizedCopy>>` where a clone with no own-rows inherits its template's map. In `route.ts:923-933`:

```ts
const templateIds = agent.messages.flatMap((m) => m.variants.map((v) => v.sourceTemplateId).filter(Boolean) as string[]);
const lookupIds = Array.from(new Set([...allVariantIds, ...templateIds]));
const rows = await prisma.messageVariantTranslation.findMany({
  where: { messageVariantId: { in: lookupIds }, status: "active" },
  select: { messageVariantId: true, language: true, title: true, body: true },
});
const byId = new Map<string, Map<string, import("@/lib/push-locale").LocalizedCopy>>();
for (const r of rows) {
  let m = byId.get(r.messageVariantId);
  if (!m) { m = new Map(); byId.set(r.messageVariantId, m); }
  m.set(r.language, { title: r.title, body: r.body });
}
for (const msg of agent.messages) for (const v of msg.variants) {
  const own = byId.get(v.id);
  if ((!own || own.size === 0) && v.sourceTemplateId) {
    const tmpl = byId.get(v.sourceTemplateId);
    if (tmpl) translationsByVariant.set(v.id, tmpl);
  } else if (own) {
    translationsByVariant.set(v.id, own);
  }
}
```

Ensure the `agent.messages` Prisma query selects `variants: { select: { ..., sourceTemplateId: true } }`.

- [ ] **Step 3: Run** `bun run test:quick` (the regression test) → PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/select-and-send/route.ts tests/regression/clone-translation-resolution.test.ts
git commit -m "fix(i18n): resolve cloned-variant translations through their template at send time"
```

---

### Task 4: Localize Guided Prayer content (lib)

**Files:**
- Modify: `src/lib/votd/guided-prayer-content.ts` (`GpContent`, `getGpContent`, `prepareGpContent`, `fetchGpVerse`)
- Modify: `src/lib/cron/send-grouping.ts:146-167` (GP branch)
- Test: `tests/unit/guided-prayer-localization.test.ts` (create)

**Interfaces:**
- Produces: `GpContent` gains `languageTag: string`. `getGpContent(prisma, date, languageTag)` and `prepareGpContent(...)` keyed by `votdContentKey(date, languageTag)` (import from `votd-user-key`). Verse text fetched with `versionForLanguage(languageTag)`.

- [ ] **Step 1: Update `GpContent` + verse fetch.** In `guided-prayer-content.ts`: add `languageTag: string` to `GpContent`; change `fetchGpVerse(usfm)` → `fetchGpVerse(usfm, versionId, languageTag)` using `versionForLanguage` (import from `./version-map`) for the `id=` query param and `Accept-Language: languageTag` header. The GP *guide* (usfm + image) stays English (guide 1 is English-only); only the verse text + labels localize — mirrors VOTD.

- [ ] **Step 2: Key the cache + prefetch by (date, language).** `getGpContent(prisma, date, languageTag)` reads/writes `guidedPrayerDailyContent` by `{ date_languageTag: { date, languageTag } }` (composite key from Task 5). `prepareGpContent` collects unique `(date, languageTag)` via `resolveVotdUserKey(input.user.attributes, input.scheduledAt)` and returns a map keyed by `votdContentKey(date, languageTag)`.

- [ ] **Step 3: Localize the GP branch in send-grouping.** `send-grouping.ts:146-167`:

```ts
if (isGp) {
  const key = resolveVotdUserKey(user.attributes, scheduledAt);
  const content = localization?.gpContent?.get(votdContentKey(key.date, key.languageTag));
  if (!content) { /* keep skip + warn */ continue; }
  const labels = guidedLabels(content.languageTag);
  // ... substituteGpTags(... labels.guidedPrayer, content.reference, content.verseText) unchanged
}
```

- [ ] **Step 4: Write unit tests** `tests/unit/guided-prayer-localization.test.ts` asserting: (a) `fetchGpVerse` requests `versionForLanguage("es")` (149) for an `es` user; (b) an unsupported language (`"zz"`) falls back to `DEFAULT_VERSION_ID` (111) via `versionForLanguage`; (c) the send-grouping GP branch uses `guidedLabels(content.languageTag)`. Mock `fetch` for the version-id assertion.

- [ ] **Step 5: Run** `bun test tests/unit/guided-prayer-localization.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/votd/guided-prayer-content.ts src/lib/cron/send-grouping.ts tests/unit/guided-prayer-localization.test.ts
git commit -m "fix(i18n): localize Guided Prayer verse + labels per user language (like VOTD)"
```

---

### Task 5: Guided Prayer per-language cache migration (schema)

**Files:**
- Modify: `prisma/schema.prisma:590-600` (`GuidedPrayerDailyContent`)
- Create: `prisma/migrations/<timestamp>_gp_per_language_cache/migration.sql` (via `prisma migrate dev`)
- Test: `tests/regression/gp-cache-language-key.test.ts` (create)

**Interfaces:**
- Produces: `GuidedPrayerDailyContent` keyed `@@unique([date, languageTag])` with a `languageTag String` column — matching `VotdDailyContent`.

- [ ] **Step 1: Update the model** in `prisma/schema.prisma` (fix the wrong doc comment too):

```prisma
/// Immutable per-day, per-language Guided Prayer cache. The GP guide is English-only,
/// so usfm/imageUrl are shared; reference/verseText are localized per languageTag.
model GuidedPrayerDailyContent {
  id          String   @id @default(cuid())
  date        String   // "YYYY-MM-DD" user-local calendar date
  languageTag String   // normalized content language, e.g. "en", "es", "zh_CN"
  usfm        String
  reference   String
  verseText   String
  imageUrl    String?
  createdAt   DateTime @default(now())

  @@unique([date, languageTag])
}
```

- [ ] **Step 2: Generate the migration** (DELIBERATE — hits the prod Neon DB per `prisma.config.ts`; confirm with the operator first). The table is tiny (≤1 row/day). Existing rows have no `languageTag`; backfill them as `'en'` in the migration SQL, then add the column/unique key.

Run: `npx prisma migrate dev --name gp_per_language_cache`
Expected: migration created + applied; `npx prisma generate` regenerates the client.

- [ ] **Step 3: Write a regression test** `tests/regression/gp-cache-language-key.test.ts` (against the local test DB, loaded from the prod dump per CLAUDE.md): insert two GP rows for the same `date` with `languageTag` `"en"` and `"es"`, assert both persist (composite key) and a `findUnique({ where: { date_languageTag: { date, languageTag: "es" } } })` returns the Spanish row. This locks in that GP can never serve `en` text to an `es` user.

- [ ] **Step 4: Run** `bun run test:int -- gp-cache-language-key` → PASS.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/regression/gp-cache-language-key.test.ts
git commit -m "feat(i18n): per-language Guided Prayer cache (date + languageTag)"
```

---

### Task 6: Full check + ship

- [ ] **Step 1:** `bun run check` (full suite). Fix any failures.
- [ ] **Step 2:** Manual/staging spot-check: an agent with an email or content-card variant + an `es` translation sends Spanish to an `es` user; a GP push sends a Spanish label+verse to an `es` user; a cloned variant serves its template's translation.
- [ ] **Step 3:** Push to `main`.

---

## Out of scope (lower-priority findings — separate follow-ups)

- **#4 Demo send path** (`src/app/api/demo/send/route.ts`) does no translation localization — diverges from cron. Wire the same template-aware strict resolver if the demo must mirror production per-language.
- **#5 `languageFilter` prefix vs canonical mismatch** — recruitment uses `startsWith` while the strict resolver needs an exact/base canonical match (no base fallback for `zh`), so e.g. `zh_HK` users are recruited then skipped. Align the recruitment predicate with `contentLanguageFor`/`resolvePushLocaleStrict`.
- **#6 Dynamic giving copy** — surrounding copy isn't language-selected and `{{bibles}}` always uses `en-US` thousands separators (`giving-copy.ts`).
