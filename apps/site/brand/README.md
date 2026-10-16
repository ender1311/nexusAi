# Site brands

The whole look of `apps/site` (the landing page at `/nexus` and the walkthrough at
`/nexus/demo`) comes from one brand preset, picked by one setting:

```bash
NEXT_PUBLIC_BRAND=human-hand   # midnight (default) | human-hand | editorial
```

There is no visitor theme picker. An unset value renders `midnight`. An unknown value
**fails the build on production** (`VERCEL_ENV=production`); everywhere else it renders
`midnight` and logs a warning.

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
| `types.ts` | `BrandPreset` and `TokenSet` types, `tokenSets()` |
| `presets/*.ts` | One file per preset |
| `presets/index.ts` | The registry (`BRANDS`), `activeBrand()`, `resolveBrand()`, `withPreset()` (overrides for tests) |
| `css.ts` | `brandCss(preset, selector)`: a preset as CSS custom properties. `allBrandsCss()`: every preset under `[data-brand="<id>"]` |
| `chart-theme.ts` | `chartThemes(preset)`: series colors, surface, line, ink, ink3 and radius for Recharts, per OS scheme |
| `font-stacks.ts` | Font keys, their CSS stacks, and `WEB_FONTS` (the next/font loader for each web font) |
| `font-codegen.ts` | Turns the active preset into the two generated font modules below |
| `active-fonts.generated.ts` | **Generated.** The active preset's web fonts, `preload: true`. The root layout imports it |
| `preview-fonts.generated.ts` | **Generated.** Every other web font, `preload: false`. Only `/nexus/brand` imports it |
| `logos.tsx` | Brand marks (`none`, `beacon`, `monogram`), drawn with tokens |
| `validate.ts` | `validatePreset()`; the tests run it on every preset |
| `contrast.ts` | WCAG luminance and contrast ratio |

The root layout sets `<html data-brand={activeBrand().id}>` and injects the active
preset's `brandCss()` in a `<style>` tag (the CSP allows inline styles). `/nexus/brand`
injects `allBrandsCss()` itself, so production pages ship one preset's tokens. `app/globals.css` maps the tokens to
Tailwind utilities in `@theme inline`, so components use `bg-surface`, `text-ink-3`,
`text-on-accent`, `rounded-brand-lg`, `font-serif` and so on. Shared class recipes
(buttons, panels, labels, fields) live in `components/ui.ts`. Any element can opt into
another preset by wrapping it in `<div data-brand="<id>">` (that's how `/nexus/brand`
works).

Charts (Recharts) need literal values, so they take `chartThemes(preset)` as a prop
(series colors, axis tick fill, axis/grid stroke, tooltip surface/ink/radius) and pick the
light or dark theme from `prefers-color-scheme`. They never use `getComputedStyle`. Client
components get brand values as props from the page, so the client bundle never loads the
preset registry.

## Fonts: the generated modules

next/font needs literal loader calls at module scope, and only fonts declared with
`preload: true` get a `<link rel="preload">`. So `scripts/gen-active-fonts.ts` (run by
`predev`, `prebuild` and `pretest`, or `bun run gen:fonts`) reads `NEXT_PUBLIC_BRAND`
and writes:

- `active-fonts.generated.ts`: the active preset's display, body and mono web fonts,
  preloaded. A preset on system fonts (Midnight) gets no loader at all, just
  `activeFontVariables = ""`.
- `preview-fonts.generated.ts`: every other web font, not preloaded, for `/nexus/brand`.

Both files are **committed for the default brand (midnight)** and not gitignored, so a
fresh clone typechecks without running the generator. Running dev, build or tests with
another `NEXT_PUBLIC_BRAND` rewrites them locally. Don't commit that; run
`bun run gen:fonts` with the variable unset to restore them. Vercel regenerates them in
`prebuild` from the project's own `NEXT_PUBLIC_BRAND`, and on production the generator
fails the build for an unknown brand.

## Adding a brand

1. Copy `presets/editorial.ts` to `presets/<id>.ts` and edit it.
2. Add it to `BRANDS` and to the `BrandId` union in `presets/index.ts`.
3. If it needs a new font, add a key to `FONT_STACKS` and a `WEB_FONTS` entry in
   `font-stacks.ts` (the next/font/google export name, a `--font-<name>` variable, any
   weight/style options), then run `bun run gen:fonts`.
4. Run `bun test` in `apps/site`. The validator and contrast tests cover the new preset
   automatically. Then look at `/nexus/brand`.

## Fields

**Identity**

- `id`: registry key, `data-brand` value and `NEXT_PUBLIC_BRAND` value (kebab-case).
- `label`: the preset's name on `/nexus/brand`.
- `identity.name`: the studio (footer copyright), e.g. "Beacon Frontier".
- `identity.product`: the product, e.g. "Nexus". Every product mention in UI chrome and
  page metadata (simulator, walkthrough steps, comparison column, flow diagram, demo
  title) reads it. Marketing copy in `content/copy.ts` stays as written.
- `identity.eyebrow`: the line above the hero heading.
- `identity.logo`: a key from `logos.tsx`; `none` shows no mark.
- `identity.ogTitle`: the landing page `<title>` and Open Graph title.
- `identity.ogDescription`: the meta and Open Graph description.

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
  - `chart`: four series colors, in order. Auto presets use each scheme's own palette.

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

Every preset and scheme (dark schemes against their own grounds) is tested for WCAG AA
(4.5:1) on:

- `ink` on `bg` and on `surface`;
- `ink3` and `accentInk` on `bg` and on `surface`;
- `onAccent` on `accent`;
- `bad` on `bg`, `surface` and `badBg`;
- `ok` on `surface`, on `okBg`, and on the accent-15% tint over `surface` (the
  walkthrough's "Chosen" row).

If your accent is too light for small text on the background (Human Hand's clay is
4.46:1 on linen), keep it for fills and set a deeper `accentInk` for text. If white text
on the accent fails, use a dark `onAccent` (Midnight's dark scheme does this). Put the
ratio in a comment next to any borderline token.

## Rules for components

A source-scan test (`tests/brand-source-scan.test.ts`) keeps `components/`, `app/`,
`lib/` and `content/` on tokens (`brand/` is exempt). It bans hex colors,
`rgb()`/`rgba()`/`hsl()`/`oklch()`, Tailwind palette colors (`text-slate-500`…),
`text-white` / `bg-white` / `text-black`, named colors in `fill=` / `stroke=` / style
objects, and fixed Tailwind radii (`rounded`, `rounded-md`, `rounded-full`…). Use the
token utilities instead.
