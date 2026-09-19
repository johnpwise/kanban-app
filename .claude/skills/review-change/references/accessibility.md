# Accessibility / UX lens

Runs when the diff changes interactive UI. Review operability, semantics, state communication,
focus integrity, and recovery paths — not visual design. Do not expand scope beyond the requested
behaviour. Separate blocking issues from follow-up polish.

## Priorities

1. **Operability** — can a keyboard-only user complete the flow? Are interactive elements real
   controls? Do busy/disabled states prevent duplicate or broken actions?
2. **Semantics and labelling** — controls semantically correct; inputs and actions have accessible
   names; help and error messages clearly associated.
3. **State communication** — loading, success, failure, and the next step are all perceivable, not
   just visually.
4. **Focus management** — focus preserved through re-renders; moves appropriately after open,
   close, submit, or error; no focus loss after conditional UI changes.
5. **Visual resilience with a11y impact** — meaning not conveyed by colour alone; truncation /
   responsive collapse does not hide critical information; status messages are not easily missed.

## Standards

- **Native semantics before ARIA.** Flag as blocking: `role="button"` on a `<div>` instead of
  `<button>`; custom controls without keyboard parity; missing heading/list/form semantics;
  ARIA that contradicts behaviour (`aria-expanded="true"` when collapsed); redundant ARIA where a
  native element solves it.
- **ARIA is required** when implementing custom interactive widgets (dropdowns, modals, tabs,
  accordions), for dynamic state not otherwise announced, and for element relationships (labels,
  descriptions, controls).
- **Accessible naming** — every interactive control has a visible label or
  `aria-label` / `aria-labelledby`. Flag icon-only buttons without an accessible name.
- **State attributes** — use `aria-expanded` / `aria-pressed` / `aria-selected` / `aria-disabled`
  where applicable; flag state changes visible only visually.
- **Relationships** — inputs associated with labels; help/error text linked via `aria-describedby`
  / `aria-labelledby`.
- **Dynamic updates** — important async updates announced via `aria-live` (sparingly); flag
  loading/success/error messages not discoverable by assistive tech.

## Always flag

`role="button"` without Enter/Space support; `tabIndex` faking interactivity; ARIA spam;
`aria-hidden="true"` on focusable/interactive elements; conflicting roles; dialogs without an
initial focus target; close flows with no focus return path; submit flows that re-render away the
active control with no next-focus plan; inline errors with no discoverable relationship to the field.

## Output into the Step Record

Status (`pass` / `pass-with-notes` / `changes-required`); blocking issues (materially impair
operability or understanding only); follow-up improvements; suggested focused test coverage.
