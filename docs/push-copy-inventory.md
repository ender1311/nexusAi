# Push Copy Inventory — Re-engagement Campaigns

Sources: `../middleman/data/translations/workflows/`, Dropbox `/code_infinity/push/` (metadata only — token lacks files.content.read)

## MAU → DAU Re-engagement Workflow
Source: `../middleman/data/translations/workflows/mau_to_dau/en.yml`

These are email subjects/previews but serve as proven push copy. 4 variants, 2 messages each.

### Variant A — Bible Habit / Consistency
| Field | Copy |
|-------|------|
| Push title 1 | "Growth is not about perfection…" |
| Push body 1 | "It's about consistency ➡️" |
| Push title 2 | "Who do you want to be?" |
| Push body 2 | "Here's what happens when you spend time with God ➡️" |
| Deep-link | `youversion://bible` |
| Theme | Bible habit, consistency, growth |

### Variant B — Verse of the Day
| Field | Copy |
|-------|------|
| Push title 1 | "What will God say to you, ${NAME}?" |
| Push body 1 | "Check out the Verse of the Day ➡️" |
| Push title 2 | "👂 Listen to God today" |
| Push body 2 | "Reflect on the Verse of the Day ➡️" |
| Deep-link | `https://www.bible.com/verse-of-the-day` ⚠️ broken on Android — use `youversion://bible` instead |
| Theme | VOTD, personalized, listening |

### Variant C — Guided Prayer
| Field | Copy |
|-------|------|
| Push title 1 | "Have a minute?" |
| Push body 1 | "Spend time with God in Guided Prayer." |
| Push title 2 | "⏸️ Pause with God" |
| Push body 2 | "Take a moment with Him today…" |
| Deep-link | `https://www.bible.com/guides/1` |
| Theme | Prayer, pause, accessible |

### Variant D — Personalized / Next Step
| Field | Copy |
|-------|------|
| Push title 1 | "${NAME}, what's your next step?" |
| Push body 1 | "Open your Bible App today!" |
| Push title 2 | "Encounter God today, ${NAME}." |
| Push body 2 | "Spend time with Him in the Bible App today." |
| Deep-link | `youversion://bible` |
| Theme | Personalized with name, next step, encounter |
| Braze Liquid | Replace `${NAME}` with `{{${first_name} | default: "friend"}}` |

---

## Lapsing Plans User Workflow
Source: `../middleman/data/translations/workflows/lapsing_plans_user_workflow/en.yml`

| Field | Copy |
|-------|------|
| Push title | "Congrats! You completed a Plan!" |
| Push body | "Choose another Plan and keep your momentum going." |
| Deep-link | `https://www.bible.com/reading-plans` |
| Theme | Completion, momentum, upsell to next plan |

---

## Give Re-engagement
Source: `../middleman/data/translations/workflows/give_reengagement/en.yml` (not yet read — content TBD)

---

## 2024 BAFK Push Notifications
Source: `../code_infinity/2024 BAFK Push Notifications/data_final/` (JSON files per locale)
- Files exist for 40+ languages including: en_GB, es_ES, pt_PT, zh_TW, zh_HK, am, sq, hr, hy, th, sr, my, is, te, ml, ta, km
- English content: not yet extracted (Dropbox `files.content.read` scope required, or read from local `/code_infinity/` Dropbox cache)

---

## Notes for Nexus Variants

1. **Personalization:** Use Braze Liquid for `${NAME}` → `{{${first_name} | default: "friend"}}`
2. **Deep-link:** For verse references, default to `youversion://bible?reference={USFM}` (e.g. `youversion://bible?reference=JHN.3.16`). Uses the user's already-set Bible version in the app. For generic re-engagement with no specific passage, use `youversion://bible` (opens at last-read position).
3. **Preferred version:** `User.attributes.preferred_bible_version_id` is available from Hightouch sync. Only needed for HTTP fallback links (`https://www.bible.com/bible/{version_id}/{USFM}`); the native `youversion://` scheme resolves the user's version automatically.
4. **VOTD link warning:** `https://www.bible.com/verse-of-the-day` is broken on Android (BA-7285). Use `https://www.bible.com/bible/?suppress_branch_meta=true` or `youversion://bible` instead.
5. **Emoji usage:** Variants B and C use emojis (👂, ⏸️, ➡️) — proven to perform. Include in push copy.
