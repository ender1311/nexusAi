# Mobile fan nav — Design

**Date:** 2026-06-08
**Status:** Approved

Give the mobile bottom-tab bar access to subpages via a "fan-up popover": tapping
a grouped tab pops a vertical stack of subpage pills rising above the tab, with a
dimmed scrim behind. Today the mobile nav has 5 hardcoded single-link tabs and
**no** way to reach subpages (e.g. Control Tower, Segments, Performance, the
Content libraries, Settings) on mobile.

---

## Goals

- Keep exactly **5** bottom tabs (no horizontal overflow on small screens).
- Make **every** page in `navTree` reachable on mobile.
- Drive the mobile nav from the single-source `navTree` data, not a second
  hardcoded list, so desktop and mobile never drift.

## Tab set & mapping

Five tabs, each mapping to a top-level concept:

| Tab | Source | On tap |
|-----|--------|--------|
| Dashboard | `navTree` Dashboard group | fan: Overview, Control Tower |
| Agents | `navTree` `/agents` single item | navigate directly (no fan) |
| Audience | `navTree` Audience group | fan: Search Users, Segments, Sizes |
| Data | `navTree` Data group | fan: Personas, Performance, Data Ingest |
| About | About group **+ folded extras** | fan (catch-all, see below) |

The requested 5-tab set (Dashboard/Agents/Audience/Data/About) drops the
desktop **Content** tab and the standalone **Settings** item. To preserve
reachability, Content's three library pages and Settings are **folded into the
About fan** below a divider.

### About fan contents

```
About
Architecture
Advanced Docs
FAQ
Demo
───────────── (divider)
Push Library
Email Library
Verse Library
Settings
```

## Data model — derived mobile view in `nav-config.ts`

Add a derived structure so the mapping is single-sourced and testable, rather
than re-listing hrefs in the component.

```ts
// A mobile tab is either a direct link or a fan group of NavItems.
export type MobileTab =
  | { kind: "link"; item: NavItem }
  | { kind: "fan"; label: string; icon: LucideIcon; children: MobileItem[] };

// A fan child is either a nav item or a visual divider.
export type MobileItem = NavItem | { divider: true };

export function isDivider(i: MobileItem): i is { divider: true } {
  return "divider" in i;
}
```

`mobileTabs` is built from `navTree` (not a fresh hardcoded list):

- **Dashboard** → fan of the Dashboard group's children.
- **Agents** → `link` to the `/agents` item.
- **Audience** → fan of the Audience group's children.
- **Data** → fan of the Data group's children.
- **About** → fan of the About group's children, then `{ divider: true }`, then
  the Content group's children (Push/Email/Verse Library), then the Settings item.

All hrefs/labels/icons are read from the existing `navTree` entries — the
builder selects and arranges them, it does not redefine them. This guarantees
that if a page's href changes in `navTree`, the mobile nav follows automatically.

## Interaction — fan-up popover

`MobileNav` becomes a client component with one piece of state:

```ts
const [openTab, setOpenTab] = useState<string | null>(null); // tab label, or null
```

- Tapping a **fan** tab toggles `openTab` between its label and `null`.
- Tapping the **link** tab (Agents) navigates via `<Link>` and sets `openTab` to
  `null`.
- When a fan is open:
  - A dimmed **scrim** (`fixed inset-0 z-40 bg-black/40`) renders behind the
    pills. Tapping it sets `openTab = null`.
  - A vertical **pill stack** rises directly above the tapped tab
    (`absolute bottom-full`, anchored to that tab's column), `z-50`, newest
    item at the bottom nearest the tab. Each pill is a `<Link>`; the divider
    renders as a thin `<hr>`/bordered separator.
  - Tapping a pill navigates and sets `openTab = null` (dismiss-on-navigate).
- Route change closes the fan: a `useEffect` on `pathname` resets `openTab` to
  `null` so the fan never lingers after navigation.

## Active state

Reuse the existing helpers from `nav-config.ts`:

- `activeHref(pathname, navTree)` → the currently active leaf href.
- A tab is **active** when the active href belongs to that tab (the link tab
  matches its own href; a fan tab matches if any of its children's hrefs equals
  the active href). The About fan counts the folded Content + Settings children.
- Within an open fan, the pill whose href equals `activeHref` is highlighted.

Highlighting uses the same `text-primary` vs `text-muted-foreground` treatment
already used by the current `MobileNav`.

## Files

- **Modify** `src/components/layout/nav-config.ts` — add `MobileTab`/`MobileItem`
  types, `isDivider` guard, and the `mobileTabs` derived builder + a
  `tabForHref`/active-tab helper.
- **Modify** `src/components/layout/sidebar.tsx` — replace hardcoded
  `mobileNavItems` + `MobileNav` body with the data-driven fan-up popover.
- **Create** `tests/regression/mobile-fan-nav.test.tsx` — happy-dom component
  test.

Desktop `Sidebar` is untouched.

## Test

`tests/regression/mobile-fan-nav.test.tsx` (happy-dom, modeled on
`tests/regression/sidebar-nav.test.tsx`):

1. **Reachability guard:** every leaf href in `navTree` (including the folded
   Push/Email/Verse libraries and Settings) appears in some tab's `mobileTabs`
   entry — fan child or link. This is the core regression: it fails if a future
   page is added to `navTree` but not surfaced on mobile.
2. **Fan reveal:** initially no fan pills are in the DOM; after a `click` on a
   fan tab (e.g. "Audience"), that group's subpage links (Search Users,
   Segments, Sizes) are present.
3. **Agents is a direct link:** the Agents tab renders an `<a href="/agents">`
   and tapping it does not open a fan.
4. **About fan catch-all:** opening the About fan exposes About/Architecture/
   Advanced Docs/FAQ/Demo **and** Push Library/Email Library/Verse Library/
   Settings.
5. **Active state:** with `usePathname` mocked to a subpage (e.g. `/audience/segments`),
   the Audience tab carries the active class.

Note (happy-dom): responsive utility classes only hide via CSS, so both the
desktop `Sidebar` and `MobileNav` DOM render; tests scope queries to the mobile
`<nav>` to avoid double-matching. Labels needing capitalization are produced in
JS, not via CSS `capitalize` (happy-dom doesn't apply text-transform to
`textContent`).

## Out of scope

- Desktop sidebar changes.
- DB-backed sync rename (separate future design).
- Animations beyond a simple show/hide (no spring/physics fan animation required;
  a CSS transition is fine but not specified here).
