# styling-and-accessibility-baseline.md

Inherit the frontend baseline (Purpose, Styling baseline, Accessibility baseline, Review
checklist) from
`agents-core/agent-docs/standards/reliability/frontend-styling-and-accessibility-standards.md`.
This file adds the Next.js-specific extensions and new section below.

## Accessibility baseline — extends the baseline
- respect reduced-motion preferences (`prefers-reduced-motion`) for any non-essential animation or
  transition introduced around route changes or interactive state
- content remains usable under browser zoom and narrow-viewport reflow; a responsive collapse must
  not hide a control's accessible name or a status message

## Next.js-specific navigation and focus behavior (new section, no baseline equivalent)

Client-side route transitions (via `next/link` or the Next.js navigation APIs) do not reload the
page, so browser-default focus-reset-on-navigation does not happen automatically. When a route
change is the primary way a user moves to new content:

- move focus to the new page's main heading or primary landmark after navigation completes, for
  flows where the change is significant enough that a screen-reader user needs to be told where they
  are now
- do not silently leave focus on a now-stale or removed control after a navigation-triggering action
- a route-level `loading.tsx` should not trap focus or block keyboard interaction indefinitely; treat
  a stuck loading state as a defect
- a route-level `error.tsx` must be reachable and operable by keyboard, with a clear, accessible way
  to retry or navigate away

## Review checklist — extends the baseline
- the baseline "focus behavior after open, close, submit, error, and rerender" item also covers:
  client-side route transitions
- the baseline "duplicate-action prevention during busy states" item also covers: a pending Server
  Action
