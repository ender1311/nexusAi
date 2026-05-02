# YouVersion Deep-Link Reference

Source: `../wayfinder/src/lib/data/deeplink-inventory-data.ts` (verified inventory)

## Key Links for Re-engagement Push Campaigns

| Intent | URL | Notes |
|--------|-----|-------|
| Open native Bible reader at last position | `youversion://bible` | Push/In-App only. No params needed — opens where user left off. |
| Open Bible reader at a specific passage | `youversion://bible?reference={USFM}` | **Default for verse references.** Uses user's already-set Bible version in the app. |
| Open Bible reader at a passage (HTTP fallback) | `https://www.bible.com/bible/{version_id}/{USFM}` | Use only when a specific version ID is required. |
| Open Bible reader (keep position, HTTP) | `https://www.bible.com/bible/?suppress_branch_meta=true` | `suppress_branch_meta=true` always required |
| Open today's Guided Scripture | `https://www.bible.com/stories` | |
| Open Verse of the Day | `https://www.bible.com/verse-of-the-day` | ⚠️ Broken on Android (BA-7285) — grey screen |
| Open Guided Prayer | `https://www.bible.com/guides/1` | guide_id=1 is Guided Prayer |
| Open Reading Plans discovery | `https://www.bible.com/reading-plans` | |
| Open a specific plan | `https://www.bible.com/reading-plans/{PLAN_ID}` | Add `?subscribe=true` to initiate start flow |
| Open user's active plans | `https://www.bible.com/my-plans` | |
| Open Discover | `https://www.bible.com/discover` | |
| Open Today feed | `https://www.bible.com/today` | |
| Open Giving | `https://www.bible.com/give` | Optional: `?fund=YouVersion&frequency=monthly&amount=25` |

## USFM Format

Single verse: `JHN.3.16`
Range: `JHN.1.1-5`
Chapter: `JHN.1`
BAL only (ranges unsupported): use `+` notation — `JHN.1.1+JHN.1.2`

## Native Scheme Links (Push / In-App Only)

| Label | URL |
|-------|-----|
| Native Bible reader (last position) | `youversion://bible` |
| Native Bible reader + passage | `youversion://bible?reference=JHN.3.16` |
| Open BAFK | `bafk://` |
| BAFK specific story | `bafk://stories/{STORY_ID}` |
| BAL Today | `/?_navigationIndex=0` |
| BAL Reader | `/?_navigationIndex=1` (optional `?reference=JHN.3.16&version=0`) |

## Deep-Link Best Practice for Re-engagement

**Default for verse references (specific passage):**
```
youversion://bible?reference=JHN.3.16
```
Uses the user's already-set Bible version in the app. Push/In-App only (native scheme). Replace `JHN.3.16` with any USFM reference.

**For generic re-engagement (no specific passage):**
```
youversion://bible
```
Opens native reader at the user's exact last-read position. No USFM needed. Works on iOS and Android. Perfect for "pick up where you left off" messaging.

**HTTP fallback (when a specific version ID is required):**
```
https://www.bible.com/bible/{{custom_attribute.${preferred_bible_version_id} | default: 1}}/JHN.3.16
```

## Full Category Reference

### Scripture (8 links)
- `https://www.bible.com/bible/{version_id}/{USFM}` — Bible Reader (Working ✅)
- `https://www.bible.com/bible/{version_id}/{USFM}?audio=true` — Audio Bible
- `https://www.bible.com/bible/?suppress_branch_meta=true` — Keep last position
- `youversion://bible` — Native reader, last position (Push/IAM only)
- `https://www.bible.com/search/bible` — Bible Search
- `https://www.bible.com/versions` — Bible Versions (Working ✅)
- `https://www.bible.com/languages` — Bible Languages
- `https://www.bible.com/languages/{LANGUAGE_TAG}` — Versions by Language (3-letter code)

### Reading Plans (6 links)
- `https://www.bible.com/reading-plans` — Find Plans
- `https://www.bible.com/reading-plans/{PLAN_ID}` — Specific Plan
- `https://www.bible.com/reading-plans/{PLAN_ID}/day/{DAY}` — Specific Day
- `https://www.bible.com/reading-plans-collection/{COLLECTION_ID}` — Collection
- `https://www.bible.com/saved_plans` — Saved Plans
- `https://www.bible.com/my-plans` — My Plans

### Prayer (4 links)
- `https://www.bible.com/prayer` — Prayer View
- `https://www.bible.com/prayers` — Prayer List
- `https://www.bible.com/prayers/add` — Add Prayer (optional: `?title=&description=&usfm=`)
- `https://www.bible.com/guides/1` — Guided Prayer (guide_id=1 only)

### Stories & Guided Scripture (4 links)
- `https://www.bible.com/stories` — Today's Guided Scripture (optional: `?cohort=kids`)
- `https://www.bible.com/stories/{STORY_ID}` — Specific Story
- `https://www.bible.com/verse-of-the-day` — VOTD ⚠️ Broken on Android
- `https://www.bible.com/{LANGUAGE_TAG}/verse-of-the-day/{USFM}/{IMAGE_ID}` — Verse Image Share

### Giving (5 links)
- `https://www.bible.com/give` — Giving (optional: fund, frequency, amount)
- `https://www.bible.com/give/history` — Giving History
- `https://www.bible.com/give/scheduled` — Scheduled Giving
- `https://www.bible.com/giving-impact` — Giving Impact
- `https://www.bible.com/donate` — (deprecated, old blog posts only)

### Social & Community (5 links)
- `https://www.bible.com/connections` — Add Friends
- `https://www.bible.com/community` — Community
- `https://www.bible.com/friends` — Friends
- `https://www.bible.com/badges` — Badges
- `https://www.bible.com/share_app` — Share App

### Content & Discovery (7 links)
- `https://www.bible.com/today` — Today Feed
- `https://www.bible.com/discover` — Discover
- `https://bible.com/blog` — Blog (English)
- `https://bible.com/blog/{LANGUAGE_TAG}/` — Blog (International)
- `https://www.bible.com/explore/churches` — Churches (Working ✅, Email only)
- `https://www.bible.com/explore/churches-near-me` — Churches Near Me (Working ✅, Email only)
- `https://www.bible.com/p/{UUID}/{PLAN_ID}` — Plans with Friends invite (generated by app)

### Settings & Account (12 links)
- `https://www.bible.com/notifications` — Notifications Inbox
- `https://www.bible.com/notifications/settings` — Notification Settings
- `https://www.bible.com/settings` — Settings
- `https://www.bible.com/settings/language` — Language Settings
- `https://www.bible.com/settings/kids` — Kids Bible Experience Settings
- `https://www.bible.com/help` — Help
- `https://www.bible.com/privacy` — Privacy Policy
- `https://www.bible.com/terms` — Terms of Use
- `https://www.bible.com/vod_subscriptions` — VOTD Subscription
- `https://www.bible.com/unsubscribe` — Unsubscribe (optional: product, type, token)
- `https://www.bible.com/unsubscribe/manage` — Unsubscribe Manage
