// Shared class recipes. Everything reads brand tokens (see app/globals.css and
// brand/), so a component never names a color, radius or font directly.

const border = "border-[length:var(--border-width)] border-line";

export const ui = {
  border,
  borderT: "border-t-[length:var(--border-width)] border-line",
  borderB: "border-b-[length:var(--border-width)] border-line",
  borderY: "border-y-[length:var(--border-width)] border-line",
  /** Display headings (h1/h2). */
  display: "font-serif font-[number:var(--display-weight)] tracking-[var(--display-tracking)]",
  /** Section vertical rhythm, from the preset's density. */
  section: "py-[var(--section-y)]",
  /** Small uppercase-or-not labels (captions, column heads). */
  label: "text-xs [text-transform:var(--label-case)] tracking-[var(--label-tracking)]",
  eyebrow: "text-sm font-medium text-accent-ink [text-transform:var(--eyebrow-case)] tracking-[var(--eyebrow-tracking)]",
  /** Panels and cards: the simulator, the walkthrough, how-it-works steps. */
  panel: `rounded-brand-lg ${border} bg-surface shadow-brand`,
  /** Boxes: stats, code, flow nodes. */
  box: `rounded-brand ${border}`,
  pill: `rounded-chip ${border}`,
  field: `w-full rounded-brand-sm ${border} bg-bg px-3 py-2 text-sm`,
  /** Button case only, for toggles and rails that keep a regular weight. */
  btnCase: "[text-transform:var(--btn-case)]",
  /** Button case and weight, for buttons that were semibold. */
  btnText: "[text-transform:var(--btn-case)] font-[number:var(--btn-weight)]",
  /** Primary button, standard size. */
  btnPrimary:
    "rounded-brand-sm bg-accent px-[var(--control-x)] py-[var(--control-y)] text-sm text-on-accent [text-transform:var(--btn-case)] font-[number:var(--btn-weight)]",
  /** Secondary button, standard size. */
  btnSecondary: `rounded-brand-sm ${border} px-[var(--control-x)] py-[var(--control-y)] text-sm [text-transform:var(--btn-case)]`,
  /** Secondary button, tight horizontal padding. */
  btnSecondarySm: `rounded-brand-sm ${border} px-[calc(var(--control-x)*0.75)] py-[var(--control-y)] text-sm [text-transform:var(--btn-case)]`,
  /** Selected / unselected toggle states. */
  toggleOn: "bg-accent text-on-accent [text-transform:var(--btn-case)]",
  toggleOff: `${border} [text-transform:var(--btn-case)]`,
} as const;
