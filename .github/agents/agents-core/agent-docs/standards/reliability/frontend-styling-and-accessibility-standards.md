# styling-and-accessibility-baseline.md (core baseline)

Each stack pack's own `frontend-styling-and-accessibility-standards.md` inherits this baseline and
states only its stack-specific delta.

## Purpose

This document defines a reusable frontend baseline for styling-related delivery and accessibility review.

## Styling baseline
- follow the repo's chosen styling system
- keep style ownership close to the component or feature
- introduce shared styling primitives only when repeated use justifies them
- avoid visual-system churn during scoped feature work

## Accessibility baseline
Every meaningful user flow should aim for:
- semantic controls
- keyboard-operable interactions
- accessible names and labels
- understandable help and error text
- clear loading, empty, error, disabled, and success states
- visible recovery paths when something fails
- prefer native HTML semantics over ARIA
- use ARIA only when native elements cannot express the required behavior
- ensure ARIA attributes accurately reflect component state and relationships
- avoid redundant or conflicting ARIA usage

## Review checklist
When UI changes are made, inspect:
- semantics of the interactive elements
- focus behavior after open, close, submit, error, and rerender
- duplicate-action prevention during busy states
- whether important meaning relies only on color
- whether responsive or zoom scenarios may hide critical labels or messages
