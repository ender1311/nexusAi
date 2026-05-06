# Dark Mode / Light Mode / System Mode Design

## Overview

Add a functional three-way theme toggle (light / dark / system) to Nexus. The CSS variables for both modes are already fully defined in `globals.css` — this spec covers only the wiring, toggle UI, and color audit.

## Architecture

Use `next-themes` (one new dependency) to manage theme state. It applies/removes the `.dark` class on `<html>`, which activates the `.dark` CSS variable block already in `globals.css`. `suppressHydrationWarning` on `<html>` silences React's hydration mismatch warning (class differs between SSR render and client after next-themes runs).

## Files Changed

| File | Change |
|------|--------|
| `package.json` | Add `next-themes` |
| `src/app/layout.tsx` | Wrap with `ThemeProvider`; add `suppressHydrationWarning` to `<html>` |
| `src/components/layout/theme-toggle.tsx` | **New** — 3-mode toggle component |
| `src/components/layout/sidebar.tsx` | Render `<ThemeToggle>` between data source toggle and user section |
| Various components | Add missing `dark:` variants for hardcoded Tailwind palette classes |

## ThemeProvider Config

```tsx
<ThemeProvider
  attribute="class"
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
>
```

- `attribute="class"` — adds/removes `.dark` on `<html>`
- `defaultTheme="system"` — respects OS preference out of the box
- `enableSystem` — required for "system" mode to resolve automatically
- `disableTransitionOnChange` — prevents color transition flash when switching

## ThemeToggle Component

**Props:** `collapsed: boolean`

**Unmounted guard:** `next-themes` defers theme resolution to the client. The component must check `mounted` state (set via `useEffect`) and render nothing until mounted to avoid hydration mismatch.

**Expanded sidebar** — 3-button pill identical to the Demo/Live toggle style:
```
[ ☀ Light ] [ ☾ Dark ] [ ⊙ System ]
```
Active button gets a highlighted background. Uses `Sun`, `Moon`, `Monitor` icons from lucide-react.

**Collapsed sidebar** — single icon button cycling `light → dark → system → light` on click:
- Light mode: show `Sun`
- Dark mode: show `Moon`
- System mode: show `Monitor`

Placed between the data source toggle section and the user info / sign-out section in the sidebar.

## Color Audit

Components with hardcoded Tailwind palette classes that need dark variants added:

| Component | Class(es) to fix |
|-----------|-----------------|
| `src/components/agents/agent-message-manager.tsx` | `bg-blue-100 text-blue-700` → add `dark:bg-blue-900/30 dark:text-blue-400`; `bg-purple-100 text-purple-700` → add `dark:bg-purple-900/30 dark:text-purple-400` |

Full audit during implementation: run `grep -r "bg-\(blue\|green\|red\|yellow\|purple\|pink\|orange\|amber\|emerald\|teal\|cyan\|indigo\|violet\)-[0-9]" src/` and add `dark:` variants wherever found without one. Skip existing `dark:` variants and Tailwind config files.

## What Is Already Covered

- All CSS variable tokens (`--background`, `--foreground`, `--card`, `--primary`, etc.) — both `:root` and `.dark` blocks exist in `globals.css`
- All shadcn/ui primitives — use CSS vars, already responsive
- Sidebar, header, charts — use CSS vars
- The `dark:bg-amber-*` / `dark:bg-emerald-*` variants on the Demo/Live toggle — already present

## Testing

- `bun run check` (typecheck + lint) passes
- Visual verification: toggle cycles correctly; page reloads persist chosen mode; system preference works when set to "system"
- No new integration or unit tests needed (toggle is trivial UI with no business logic)
