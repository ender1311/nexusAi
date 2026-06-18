# Nexus — Video Design System (frame.md)

Brand identity for Nexus explainer videos. These are the camera-ready tokens.

## Palette

| Token            | Hex       | Use                                                |
| ---------------- | --------- | -------------------------------------------------- |
| Ink (bg)         | `#121212` | Primary dark background                            |
| Off-white (fg)   | `#fcfafa` | Primary text on dark                               |
| Nexus Red        | `#ff3d4d` | Primary accent — highlights, winning state, CTA    |
| Red Deep         | `#e6323f` | Accent shade / gradients with Nexus Red            |
| Red Soft         | `#ff6976` | Secondary accent, softer emphasis                  |
| Grow Green       | `#57a16c` | "Bearing fruit" / positive growth signal          |
| Muted            | `#8a8a8a` | Secondary/label text on dark (passes AA at 20px+)  |
| Card             | `#1c1a1a` | Raised surfaces / panels on the ink background     |
| Hairline         | `#302726` | Borders, dividers                                  |

Non-technical (about) videos lead with **Nexus Red**. Technical (architecture) videos may add **Grow Green** for data/positive states.

## Typography

- **Display + body:** `Inter` (weights 600–800 for headlines, 400–500 for body). Built-in.
- **Mono / data / code:** `Geist Mono` (fallback `JetBrains Mono`). Use for stats, API snippets, labels.
- Headlines 72–140px. Body 28–44px. Data labels 20–28px. `font-variant-numeric: tabular-nums` on all numbers.
- Tight tracking on display type: `letter-spacing: -0.03em`.

## Corners & depth

- Border radius: 16–24px on cards, 999px on pills/badges.
- Depth: localized glows and soft shadows, not heavy drop-shadows. Avoid full-screen linear gradients on the ink bg (banding) — use radial glows or solid + localized accent.

## Motion

- Calm, confident pacing. `power3.out` / `expo.out` for entrances; vary at least 3 eases per scene.
- Accent reveals (red) can use a slight overshoot `back.out(1.4)`.
- Scene transitions: crossfades and clean wipes. No jump cuts.

## Voice / tone

- Plain-spoken, warm, never corporate. Uses the "Sower" farming metaphor for the non-technical audience: seeds (messages), soil (audiences/personas), bearing fruit (what works).

## What NOT to do

- No blue (`#3b82f6`), no generic grays like `#333`, no `Roboto`/`Arial`.
- No web-UI opacity values for accents — use color at full, video-appropriate scale.
- No emojis.
