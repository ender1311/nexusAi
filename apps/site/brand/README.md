# Site brands

The whole look of `apps/site` (the landing page at `/nexus` and the walkthrough at
`/nexus/demo`) comes from one brand preset, picked by one setting:

```bash
NEXT_PUBLIC_BRAND=human-hand   # midnight (default) | human-hand | editorial
```

There is no visitor theme picker. An unset value renders `midnight`; an unknown value
renders `midnight` and logs a warning during the build.

**To switch the live site:** set `NEXT_PUBLIC_BRAND` on the `nexus-site` Vercel project
(Production, and Preview if you want previews to match) and redeploy. It's a
`NEXT_PUBLIC_` variable, so it is inlined at build time: changing it without a
redeploy does nothing.

**To compare presets:** open `/nexus/brand` on any non-production deployment (or
`bun run dev`). It shows a sample of every preset side by side. It returns 404 when
`VERCEL_ENV=production` and is never indexed.

## How it fits together

| File | Role |
|---|---|
| `types.ts` | `BrandPreset` and `TokenSet` types, `tokenSets()`, `chartPalette()` |
| `presets/*.ts` | One file per preset |
| `presets/index.ts` | The registry (`BRANDS`), `activeBrand()`, `resolveBrand()`, `withPreset()` (overrides for tests) |
| `css.ts` | `brandCss(preset, selector)`: a preset as CSS custom properties. `allBrandsCss()`: every preset under `[data-brand="<id>"]` |
| `font-stacks.ts` | Font keys and their CSS stacks (pure, safe to import anywhere) |
| `fonts.ts` | The `next/font` loaders (self-hosted; the CSP is `font-src 'self'`). Only the root layout imports it |
| `logos.tsx` | Brand marks (`none`, `beacon`, `monogram`), drawn with tokens |
| `validate.ts` | `validatePreset()`; the tests run it on every preset |
| `contrast.ts` | WCAG luminance and contrast ratio |

The root layout sets `<html data-brand={activeBrand().id}>` and injects `allBrandsCss()`
in a `<style>` tag (the CSP allows inline styles). `app/globals.css` maps the tokens to
Tailwind utilities in `@theme inline`, so components use `bg-surface`, `text-ink-3`,
`text-on-accent`, `rounded-brand-lg`, `font-serif` and so on. Shared class recipes
(buttons, panels, labels, fields) live in `components/ui.ts`. Any element can opt into
another preset by wrapping it in `<div data-brand="<id>">` (that's how `/nexus/brand`
works).

Charts (Recharts) need literal colors, so they take a `palette` prop read from the
preset with `chartPalette(preset)`, never from `getComputedStyle`.

## Adding a brand

1. Copy `presets/editorial.ts` to `presets/<id>.ts` and edit it.
2. Add it to `BRANDS` and to the `BrandId` union in `presets/index.ts`.
3. If it needs a new font, add a loader to `fonts.ts` (module scope, `display: "swap"`,
   `preload: false`, a `--font-<name>` variable) and a key to `font-stacks.ts`.
4. Run `bun test` in `apps/site`. The validator and contrast tests cover the new preset
   automatically. Then look at `/nexus/brand`.

## Fields

**Identity**

- `id`: registry key, `data-brand` value and `NEXT_PUBLIC_BRAND` value (kebab-case).
- `label`: the preset's name on `/nexus/brand`.
- `identity.name`: the studio (footer copyright), e.g. "Beacon Frontier".
- `identity.product`: the product, e.g. "Nexus" (comparison column, flow diagram, back link, demo title).
- `identity.eyebrow`: the line above the hero heading.
- `identity.logo`: a key from `logos.tsx`; `none` shows no mark.
- `identity.ogTitle`: the landing page `<title>` and Open Graph title.

Marketing copy stays in `content/copy.ts`; only brand identity lives in presets.

**Color**

- `colorScheme`: `"light"` (needs `light`), `"dark"` (needs `dark`) or `"auto"` (needs both;
  `dark` applies under `prefers-color-scheme: dark`). Light and dark presets also set the
  CSS `color-scheme`; auto leaves it unset, as the original site did.
- Each token set (all 6-digit hex):
  - `bg`: page background. `surface`: panels, cards, code. `surface2`: a quieter fill.
  - `ink`: body text. `ink2`: secondary text. `ink3`: muted text (captions, labels).
  - `line`: borders and rules.
  - `accent`: buttons, active pills, highlights. `accentInk`: small accent-colored text
    (eyebrow, links, the "Nexus" column). `onAccent`: text on accent fills.
  - `ok` / `okBg`, `bad` / `badBg`: success and error text and fills.
  - `focus`: the focus ring. `mark`: text selection.
  - `chart`: four series colors, in order. Auto presets use the light set's palette in
    both schemes, so pick colors that read on both grounds.

**Type**

- `fonts.display`, `fonts.body`, `fonts.mono`: keys from `font-stacks.ts`
  (`system`, `system-mono`, `inter`, `figtree`, `instrument-serif`, `fraunces`, `ibm-plex-mono`).
  Display is used for h1/h2 (`font-serif`), mono for code blocks.
- `fonts.displayWeight`: e.g. `"700"`. `fonts.displayTracking`: e.g. `"-0.01em"`; the hero
  heading is set 0.025em tighter than this.

**Shape**

- `radiusSm`: buttons, fields, small toggles (`rounded-brand-sm`).
- `radius`: boxes such as stats, code blocks, flow nodes (`rounded-brand`).
- `radiusLg`: panels and cards (`rounded-brand-lg`).
- `radiusChip`: pills and chips (`rounded-chip`).
- `shadow`: on panels and cards. `shadowPop`: on the design-partner offer.
- `borderWidth`: every border.

**Text treatments**

- `labelCase` (`none` | `uppercase`), `labelTracking`: small labels and captions.
- `eyebrowCase`, `eyebrowTracking`: the hero eyebrow.
- `btnCase`, `btnWeight`: button text.

**Density**: `compact` | `comfortable` | `airy` sets `--section-y` (section padding) and
`--control-x` / `--control-y` (button padding). `comfortable` is the original spacing.

**Layout**

- `layout.sections`: which landing sections render, in order. Any of `hero`, `stack`,
  `simulator`, `how`, `comparison`, `offer`, `faq`. `offer` is required (the validator
  fails without it); no duplicates.
- `layout.hero`: `left` or `centered`.

## Contrast

Every preset and scheme is tested for WCAG AA (4.5:1) on:

- `ink` on `bg` and on `surface`;
- `ink3` on `bg`;
- `accentInk` on `bg`;
- `onAccent` on `accent`.

If your accent is too light for small text on the background (Human Hand's clay is
4.46:1 on linen), keep it for fills and set a deeper `accentInk` for text. If white text
on the accent fails, use a dark `onAccent` (Midnight's dark scheme does this). Put the
ratio in a comment next to any borderline token.

## Rules for components

A source-scan test (`tests/brand-source-scan.test.ts`) keeps `components/` and `app/`
on tokens: no hex colors, no `text-white` / `bg-white` / `text-black`, no fixed Tailwind
radii (`rounded`, `rounded-md`, `rounded-full`…). Use the token utilities instead.
