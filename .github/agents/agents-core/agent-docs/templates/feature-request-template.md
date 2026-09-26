# Feature Request Template

Use this template to capture a feature request in a structured, implementation-ready way.

## Purpose

Describe the user problem, desired outcome, and constraints clearly enough for normalization.
After trigger validation, write these facts once to the workflow's canonical
`.agent-workflows/<workflow_id>/slice-spec.json` with `sourceType: user`; that file becomes the
source of truth for planning, ledger events, checkpoints, and handoffs. Keep this intake concise
and do not preserve a second normalized copy.

## Workflow Intake Envelope (Required)

This template captures feature details only. Before submitting, prepend the active stack/repo reusable feature intake trigger template.

### Intake Checklist

- [ ] Reusable trigger starter from active stack prompt is included verbatim.
- [ ] Trigger block includes `Use agent spec: Delivery-Engineer`.
- [ ] Next non-empty trigger line is exactly `New Feature`.
- [ ] This template content appears after the trigger block.

## Request Summary

- **Title:**
- **Requested By:**
- **Date:**
- **Intake Trigger Source:** (path to reusable trigger template used)

## Problem Statement

- What problem exists today?
- Who is affected?
- Why does it matter?

## Desired Outcome

- What should be possible after this change?
- What user or business value does it create?

## Scope

- **In Scope:**
- **Out of Scope / Non-goals:**

## Acceptance Criteria

1.
2.
3.

## Constraints

- Technical constraints:
- Product or policy constraints:
- Rollout or compatibility constraints:

## Dependencies / Related Systems

- Data or service dependencies:
- Contract implications:
- External coordination needed:

## Risks / Unknowns

- Known risks:
- Open questions:
- Assumptions:

## Validation

- How should success be verified?
- What would count as done?

## Canonicalization Result (Workflow Owner)

- **Slice spec:** `.agent-workflows/<workflow_id>/slice-spec.json`
- **Slice ID / revision:**
- **Unresolved intake fields:** (none, or fields requiring user clarification)
