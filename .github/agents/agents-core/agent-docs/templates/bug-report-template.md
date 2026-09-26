# Bug Report Template

Use this template to make a bug reproducible, scoped, and ready for triage. After trigger
validation, write these facts once to the workflow's canonical
`.agent-workflows/<workflow_id>/slice-spec.json` with `sourceType: user`; that file becomes the
source of truth for planning, ledger events, checkpoints, and handoffs. Keep this intake concise
and do not preserve a second normalized copy.

## Workflow Intake Envelope (Required)

This template captures bug details only. Before submitting, prepend the active stack/repo reusable bug intake trigger template.

### Intake Checklist

- [ ] Reusable trigger starter from active stack prompt is included verbatim.
- [ ] Trigger block includes `Use agent spec: Delivery-Engineer`.
- [ ] Next non-empty trigger line is exactly `Bug Fix`.
- [ ] This template content appears after the trigger block.

## Report Summary

- **Title:**
- **Reported By:**
- **Date:**
- **Severity / Impact:**
- **Intake Trigger Source:** (path to reusable trigger template used)

## Environment

- Environment / stage:
- Platform / OS:
- Browser / client / runtime version:
- Relevant configuration:

## Current Behavior

- What happened?
- How often does it happen?
- Who is affected?

## Expected Behavior

- What should have happened instead?

## Reproduction Steps

1.
2.
3.

## Evidence

- Logs / errors:
- Screenshots / recordings:
- Related traces or IDs:

## Scope / Suspected Area

- Files, modules, routes, or services likely involved:
- Known recent changes:

## Workarounds

- Is there a temporary workaround?

## Notes

- Additional context:
- Open questions:

## Canonicalization Result (Workflow Owner)

- **Slice spec:** `.agent-workflows/<workflow_id>/slice-spec.json`
- **Slice ID / revision:**
- **Unresolved intake fields:** (none, or fields requiring user clarification)
