# YouVersion Nexus Personas

> **Two kinds of persona.** These eight are the **hand-authored archetypes** assigned by the
> rule-based classifier (`plan-persona-classifier.ts`) from YouVersion plan/prayer/scripture
> attributes. They are distinct from the **discovered personas** produced by unsupervised
> clustering of behavioral feature vectors (`source: "discovered"`, see
> `docs/persona-discovery.md`). Both populate `Persona` rows and segment `PersonaArmStats`
> bandit arms; the classifier archetypes carry `source: "classifier"`/seed and are stable,
> while discovered personas are recomputed by the discovery pipeline.

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
5. **Anxious** — emotional content tag with prayer/scripture year-count ≥ 2, *or* prayer/scripture year-count ≥ 5 with plan year-count < 20
6. **Word-driven** — Bible-first tag or plan length ≥ 90 days, with prayer year-count < 3
7. **Studious** — Devotion-first tag, or plan year-count ≥ 30 with ≥ 3 lifetime finishes
8. **Connected** — Social-first tag or badge year-count ≥ 5
9. **Searching (fallback)** — explicit zero engagement (0 lifetime finishes, low year/month counts) → Seeker
10. `null` — not enough signal

## Seed script

```bash
bun scripts/seed-yv-personas.ts
```

Destructive — clears PersonaArmStats, LinUCBArm, AgentPersonaTarget, and user persona assignments before re-creating the 8 personas.
