# Preferred-Channel Sync Fix — Data Contract for Hightouch

**Status:** blocker for the push preferred-channel eligibility gate (Feature C). The
gate has no data to act on until this is fixed upstream in Hightouch.

**Audience:** whoever edits the Hightouch user syncs + source model. Nexus itself
needs **no change** — its ingest is a verbatim pass-through and `dashboard.ts`
already reads the canonical keys below.

---

## What's broken (verified against production, 33.8M users, 2026-06-03)

Two independent problems, both must be fixed:

### 1. Key-name drift — live syncs emit off-contract keys
The canonical contract (`docs/hightouch-ingest-users-payload.json`) and Nexus code
(`src/lib/cache/dashboard.ts:146-151`) read the **long-form** keys:

| Canonical key Nexus reads          | users with key present |
|-------------------------------------|------------------------|
| `preferred_channel_external_30_days`| **0** |
| `preferred_channel_external_90_days`| **0** |
| `preferred_channel_overall_30_days` | **0** |
| `preferred_channel_overall_90_days` | **0** |

The **live per-stage syncs** (`wau`, `lapsed`, `new_user`, `connected`) instead emit
the **short form**, overall-only:

| Key actually emitted          | users with key present | non-empty values |
|-------------------------------|------------------------|------------------|
| `preferred_channel_30d`       | 871,028 | **0** |
| `preferred_channel_90d`       | 871,028 | **0** |
| `preferred_channel_external_30d` | 871,028 | **0** |
| `preferred_channel_external_90d` | 871,028 | **0** |

The `mau` syncs (`hightouch-habitual-mau-payload.json`, `hightouch-template-payload-v4.json`)
emit **no** preferred-channel keys at all.

### 2. Empty source traits — values are blank everywhere
Across **every** key variant above, the non-empty value count is **0**. The
templates map `{{ row['Preferred Channel External 30 Days'] }}` etc., but those
source trait columns render empty strings — i.e. the trait isn't computed/populated
in the Hightouch source model.

---

## The fix (in Hightouch)

### A. Populate the source trait columns
The four trait columns must carry real values (currently empty):
- `Preferred Channel External 30 Days`
- `Preferred Channel External 90 Days`
- `Preferred Channel Overall 30 Days`
- `Preferred Channel Overall 90 Days`

**Value vocabulary** (from the canonical contract):
- **External** keys ∈ `{ push_notification, email }`
- **Overall** keys additionally allow `{ in_app_message, content_card }`

A user with no engagement in the window should be **absent / null**, not an empty
string, so Nexus can distinguish "no signal" from a real preference.

### B. Align every live sync to the canonical long-form keys
Bring all per-stage sync templates in line with `docs/hightouch-ingest-users-payload.json`,
emitting these exact keys (do **not** rename — Nexus reads them verbatim):

```jsonc
"preferred_channel_external_30_days": "{{ row['Preferred Channel External 30 Days'] }}",
"preferred_channel_external_90_days": "{{ row['Preferred Channel External 90 Days'] }}",
"preferred_channel_overall_30_days":  "{{ row['Preferred Channel Overall 30 Days'] }}",
"preferred_channel_overall_90_days":  "{{ row['Preferred Channel Overall 90 Days'] }}"
```

Syncs to update:
- `wau`, `lapsed`, `new_user`, `connected` — currently emit short-form overall-only;
  switch to the four long-form keys above (adds the **external** signal the gate needs).
- `mau` (habitual-mau, v4) — currently emit none; add the four long-form keys.

---

## How Nexus will consume it (once data flows)

Per-funnel-stage primary window for the **external** preferred channel:
- `dau4`, `wau` → `preferred_channel_external_30_days`
- `mau`, `lapsed_*` → `preferred_channel_external_90_days`
- `new` / `new_user` → **exempt** (no preferred-channel gate; targeted broadly)

The opt-out flag `newsletter_push_enabled !== false` remains a hard gate applied
before any preferred-channel logic.

---

## Verification after the fix
Re-run a read-only count; expect non-zero `non-empty-value` for the long-form keys:

```sql
SELECT
  COUNT(*) FILTER (WHERE NULLIF(TRIM(attributes->>'preferred_channel_external_30_days'),'') IS NOT NULL) AS ext_30d,
  COUNT(*) FILTER (WHERE NULLIF(TRIM(attributes->>'preferred_channel_external_90_days'),'') IS NOT NULL) AS ext_90d
FROM "User";
```
