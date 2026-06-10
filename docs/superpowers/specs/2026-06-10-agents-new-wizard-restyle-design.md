# /agents/new Wizard Restyle — Design

**Date:** 2026-06-10
**Status:** Approved by Dan (structure choice: "Keep 5 steps, restyle")

## Goal

Make the agent-creation wizard at `/agents/new` intuitive and visually consistent with the
unified agent Settings tab (MR !370, `src/components/agents/agent-settings-editor.tsx`),
without changing the step flow, wizard state model, or the POST `/api/agents` payload.

## Context

The wizard (`src/components/agents/agent-wizard.tsx`, ~1,255 lines) predates the unified
Settings tab. It works, but:

- Sections are plain `border rounded-lg p-4` boxes while the Settings tab uses
  `Card`/`CardHeader`/`CardTitle` + `InfoTip` tooltips.
- A 56-line `SegmentCheckList` component is duplicated verbatim in both the wizard
  (agent-wizard.tsx:149–205) and the settings editor (agent-settings-editor.tsx:108–164).
- The Next/Launch buttons disable silently — users don't learn what's missing until
  step 5 or a backend rejection.
- Switching channels on the Messages step resets `variants` to a single empty variant,
  silently discarding drafts.
- Terminology drifts from the Settings tab: "HT Segment" button label, unexplained
  epsilon slider, thin enrollment-mode explanation.
- The segment picker truncates at `max-h-48` with no indication more segments exist.

## Decisions (approved)

### 1. Visual language — every step

Replace each section's bordered `div` with the Settings tab's card pattern:
`Card` > `CardHeader` (`CardTitle` + optional `CardDescription`) > `CardContent`.
Use `InfoTip` for help text that is currently inline muted prose where the Settings tab
uses a tooltip for the equivalent field. The Review step (step 5) renders the same
label/value `Row` presentation the Settings tab uses in view mode, so the launch summary
visually matches what the user will later see when viewing/editing the agent.

### 2. Shared SegmentCheckList

Extract the duplicated component into `src/components/agents/segment-check-list.tsx`
(client component, same props: segments with user counts + "taken by" labels, checked
set, onToggle, disabled state). Both `agent-wizard.tsx` and `agent-settings-editor.tsx`
import it. Improvements over the inlined copies:

- Taller scroll area (`max-h-72`) so more segments are visible.
- A footer line showing "N segments" so long lists are never silently cut off.

Behavior is otherwise identical — no API or selection-logic changes.

### 3. Validation that explains itself

Keep per-step gating, but a disabled Next/Launch button is always accompanied by inline
hint text explaining what's missing:

- Step 1: "Enter an agent name" / "Choose a funnel stage or at least one include segment".
- Step 5 (Launch): the same hints, plus the existing inline submit-error display.

No new validation rules — only surfacing the existing gating conditions as visible text.

### 4. Targeted UX fixes

- **Channel draft preservation (Messages step):** keep per-channel draft state keyed by
  channel (`Record<Channel, Variant[]>`); switching channels restores that channel's
  drafts instead of resetting to one empty variant.
- **Terminology:** "HT Segment" → "Segment"; targeting-mode labels match the Settings
  tab ("Funnel Stage" / "Segment").
- **Epsilon slider:** label + one-line explanation (percent of sends that explore a
  random variant instead of exploiting the current best).
- **Enrollment mode:** same Fixed/Continuous explainer treatment the Settings tab uses.

### 5. Testing

- Regression test pinning that `SegmentCheckList` is defined only in the shared file —
  neither `agent-wizard.tsx` nor `agent-settings-editor.tsx` re-declares it (source-text
  assertion, same style as `tests/regression/agent-settings-single-edit-surface.test.ts`).
- Component tests (happy-dom, same harness as
  `tests/regression/agent-config-mutation-error-handling.test.tsx`):
  - Channel switch on the Messages step preserves the previous channel's drafts.
  - Step-1 hint text appears when name/targeting is missing and disappears when satisfied.
- Existing wizard behavior (step order, submit payload) is covered by leaving the state
  model and submit handler untouched; `bun run check` must stay green.

## Out of scope

- POST `/api/agents` payload, route, or backend validation.
- Step count/order, the goals model, TemplatePicker internals, persona selection logic.
- The Settings tab itself, except for swapping its inlined SegmentCheckList for the
  shared import (no visual change there beyond the taller list + count footer).

## Risks

- `agent-wizard.tsx` is large; restyle commits should be per-step to keep diffs
  reviewable and bisectable.
- The settings editor import swap touches a just-shipped surface — the existing
  regression suite (`agent-settings-single-edit-surface`,
  `agent-config-mutation-error-handling`) must pass unchanged.
