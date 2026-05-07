# Push Library Admin Page — Design Spec

**Date:** 2026-05-06
**Status:** Approved — ready for implementation plan
**Route:** `/push-library`

---

## Overview

A dedicated page for managing the push copy template library. All authenticated users (`@youversion.com` / `@life.church`) can browse templates. Users with the WorkOS `admin` role (currently `dan.luk@youversion.com`) can create, edit, and delete templates.

Templates are `MessageVariant` rows owned by the `__push-copy-library__` agent. Edits propagate automatically to all clones in agent-specific messages via the existing `PATCH /api/variants/[id]` clone-sync mechanism.

---

## Auth

WorkOS AuthKit is already integrated. Role check:

```ts
const { user } = await withAuth();
const isAdmin = user?.roles?.includes("admin") ?? false;
```

- **Viewer** (any logged-in user): sees all templates, read-only
- **Admin** (`roles` includes `"admin"`): sees Edit/Delete buttons per card, "New Template" button in header

All write operations (POST, PATCH, DELETE) also re-check `isAdmin` server-side in the API route handler — the UI hiding controls is not the security boundary.

To assign the admin role: WorkOS Dashboard → Directory → Users → `dan.luk@youversion.com` → Roles → add `admin`.

---

## Page Structure

**Sidebar:** New nav item "Push Library" with `BookOpen` icon, placed between "Messages" and "Personas".

**Page layout:**
- Header: "Push Library" title + template count badge + "New Template" button (admin only)
- Body: templates grouped by `category`, then `subcategory` within each group
- Each group rendered as a collapsible section with a count badge
- Each template shown as a card with:
  - `PushNotificationPreview` (reusing existing component)
  - Name + subcategory badge
  - Deeplink URL (truncated)
  - Edit + Delete buttons (admin only)

**Delete** uses a shadcn `AlertDialog` for confirmation before firing.

**Create / Edit** uses a shadcn `Sheet` (side drawer) — no page navigation.

---

## CRUD Form (Sheet Drawer)

Fields:

| Field | Input | Notes |
|---|---|---|
| Name | Text input | e.g. "A — Consistency" |
| Category | Select | `reader` / `plans` / `votd` / `guided-scripture` / `guided-prayer` |
| Subcategory | Select | Options filtered by selected category (see below) |
| Title | Text input | Push notification title |
| Body | Textarea | Push body copy |
| Deeplink | Combobox | Searches `Deeplink` catalog by label/url; free-text fallback |
| CTA | Text input | Optional button label |

A live `PushNotificationPreview` renders below the form as title/body update.

On submit: `POST /api/push-library` (create) or `PATCH /api/variants/[id]` (edit).
Page revalidates via `router.refresh()` after success.

---

## API Routes

### `GET /api/push-library`

Returns all active variants in `__push-copy-library__`, grouped by category.

**Response:**
```ts
{
  data: Array<{
    category: string;
    subcategory: string | null;
    variants: Array<{
      id: string;
      name: string;
      title: string | null;
      body: string;
      deeplink: string | null;
      cta: string | null;
      category: string | null;
      subcategory: string | null;
    }>;
  }>;
}
```

Auth: any authenticated user (middleware handles).

### `POST /api/push-library`

Creates a new `MessageVariant` under the library agent. Finds the existing `Message` for the given category/subcategory combo, or creates a new one if it doesn't exist.

**Request body:**
```ts
{
  name: string;
  category: string;
  subcategory?: string;
  title?: string;
  body: string;
  deeplink?: string;
  cta?: string;
}
```

Auth: requires `isAdmin` — returns 403 otherwise.

### `PATCH /api/variants/[id]`

Already exists. Updates variant fields and syncs copy fields to all clones. Used as-is for edits.

Auth: open to any authenticated user currently — no change needed for MVP (library page only renders Edit for admins).

### `DELETE /api/push-library/[id]`

Soft-deletes: sets `status: "archived"` on the template variant. Clones retain their `sourceTemplateId` reference and keep working; the nightly sync cron skips archived templates.

Auth: requires `isAdmin` — returns 403 otherwise.

---

## File Map

| Action | Path |
|---|---|
| Create | `src/app/push-library/page.tsx` |
| Create | `src/app/push-library/loading.tsx` |
| Create | `src/components/push-library/template-card.tsx` |
| Create | `src/components/push-library/template-form-sheet.tsx` |
| Create | `src/components/push-library/delete-confirm-dialog.tsx` |
| Create | `src/app/api/push-library/route.ts` |
| Create | `src/app/api/push-library/[id]/route.ts` |
| Modify | `src/components/layout/sidebar.tsx` |
| Modify | `src/lib/auth.ts` |
| Create | `tests/integration/push-library.test.ts` |

---

## Testing

Integration tests in `tests/integration/push-library.test.ts`:
- `GET /api/push-library` returns grouped variants
- `POST /api/push-library` creates variant under library agent (admin token)
- `POST /api/push-library` returns 403 for non-admin
- `DELETE /api/push-library/[id]` archives variant (admin token)
- `DELETE /api/push-library/[id]` returns 403 for non-admin
- Deleted (archived) template no longer appears in `GET /api/push-library`

---

## Open Questions

- **WorkOS role assignment:** `dan.luk@youversion.com` needs the `admin` role assigned manually in the WorkOS dashboard before admin controls appear. This is a manual ops step, not code.
- **WorkOS role assignment:** `dan.luk@youversion.com` needs the `admin` role assigned manually in the WorkOS dashboard before admin controls appear.

**Subcategory map** (hardcoded in form, matches seed script):
```ts
const SUBCATEGORIES: Record<string, string[]> = {
  reader:           ["open-bible", "audio-bible", "specific-verse"],
  plans:            ["find-plans", "my-plans", "saved-plans"],
  votd:             ["votd-page", "todays-story"],
  "guided-scripture": [],   // no subcategory split
  "guided-prayer":  ["guided-prayer", "prayer-list"],
};
```
