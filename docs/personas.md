# YouVersion Nexus Personas

Eight behavioral archetypes used for bandit arm segmentation. Each persona maps a `label` (used in the classifier and DB) to a short display `name`.

| Name | Label (DB) | Icon | Color | Description |
|---|---|---|---|---|
| Anxious | Emotion-first | Heart | purple | Opens the app in moments of anxiety, grief, or overwhelm. Needs to feel seen before they feel taught. |
| Studious | Devotion-first | BookOpen | blue | Already has a quiet-time habit. Wants depth, not encouragement. Easily condescended to. |
| Connected | Social-first | Share2 | green | Faith lives in community. Will leave if the experience feels solo. |
| Word-driven | Bible-first | Quote | amber | Seminary-trained or scripture-first. Zero patience for friction — wants the text, fast. |
| Plugged-in | Church-first | Landmark | red | Downloaded because their pastor said so. Stays only if their church is front-and-center. |
| Searching | Seeker | Compass | teal | Curious, not religious. Easily spooked by insider language. Wants a welcome mat, not a seminary. |
| Family-first | Parent | CalendarDays | orange | Time-poor, wants to lead their family in faith. Not here for a solo reading plan. |
| Returning | Re-engager | Sprout | slate | Was active, life got in the way. Back now — shame will send them packing. |

## Classifier

`src/lib/engine/plan-persona-classifier.ts` — pure function, no DB calls.

Priority order (first match wins):
1. **Returning** — lifetime finishes ≥ 2, zero activity this year
2. **Family-first** — plan tagged `Parent`
3. **Searching** — plan tagged `Seeker`, low engagement
4. **Plugged-in** — Life.Church publisher
5. **Anxious** — emotional content tag + meaningful prayer/scripture usage
6. **Word-driven** — Bible-first tag or plan length ≥ 90 days, low prayer
7. **Studious** — Devotion-first tag or high devotional frequency
8. **Connected** — Social-first tag or badge count ≥ 5
9. `null` — not enough signal

## Seed script

```bash
bun scripts/seed-yv-personas.ts
```

Destructive — clears PersonaArmStats, LinUCBArm, AgentPersonaTarget, and user persona assignments before re-creating the 8 personas.
