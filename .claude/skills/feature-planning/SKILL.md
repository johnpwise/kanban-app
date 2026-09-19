---
name: feature-planning
description: Turn a feature or bug request into a small, incremental delivery plan with a lean test strategy, capability ownership, and explicit evidence gates. Use inline at the start of a delivery slice (a New Feature or Bug Fix request), before writing any test or production code. Replaces the retired feature-plan-delivery-orchestrator and test-strategy-engineer agents.
---

# Feature Planning

Apply this skill **inline** as the plan step of a delivery slice — it is procedure the Delivery
Engineer runs in the primary context, not a separate agent. It produces one persisted plan under
the Artifact budgets ceiling (600–1,000 words) and a test strategy for each TDD increment.

## Vocabulary

- **Delivery slice** — one feature request, bug report, refactor, or roadmap item. One primary
  context (the Delivery Engineer) owns it from intake to closeout. "Slice" means "delivery slice".
- **TDD increment** — a small, independently reviewable unit inside a slice: one
  RED → GREEN → REFACTOR cycle for one behaviour (or a tight group of related behaviours). An
  increment is **not** a nested workflow — intake, planning, and closeout happen once per slice,
  never per increment.
- **Behaviour** — the user-observable change an increment delivers. Tests target behaviour, not
  incidental implementation detail.

Do not delegate planning. Delegate only when the Delegation Gate in
`reasoning-selection-policy.md` is met — for an unresolved architecture question, consult
`architecture-advisor`. A new dependency is assessed inline with `skills/dependency-assessment/`
(escalate a genuinely unusual one to the user).

## Planning principles

- Optimise for small diffs and easy rollback. Prefer incremental delivery over a big-bang change.
- Preserve existing contracts unless the change is intentional; keep non-goals explicit.
- Surface assumptions and unknowns early. Separate must-have scope from optional scope.
- Test behaviour, not incidental implementation detail. Prefer high-signal coverage over raw test
  count — cover the changed surface and the most likely regressions.

## Plan output

Produce, against the source of truth (link it — do not restate it):

- **Feature/bug summary** and desired user-visible behaviour.
- **Complexity classification** — `trivial` or `non-trivial`, with a one-line rationale.
- **In scope / out of scope.**
- **Increment plan** — an ordered list of small, reviewable TDD increments. Each names the
  behaviour it adds and what "done" looks like.
- **Risks, unknowns, sequencing constraints.**
- **Approvals required** — anything that crosses an approval boundary (new dependency, new
  architecture/boundary, new runtime assumption, contract change affecting other consumers,
  material scope expansion).
- **`capability_owners`** per increment (stack-defined required keys; never package names). For a
  frontend increment using `shared_client_state_owner`, also `shared_client_state_tier`
  (`subtree` | `cross_feature`).
- **`test_layer_matrix`** per increment — `unit`, `component`, `integration`, `e2e`, each
  `required` or `N/A` with a one-line rationale.
- **`required_preimplementation_tests`** per increment and the
  **`preimplementation_failing_test_evidence`** expected (which layers must fail before production
  code changes).
- **`e2e_status`** timing — `planned` before implementation, `passing` before closeout when
  required.
- **Contract modelling** — for any increment that introduces or reshapes an API boundary, model
  the contract up front (endpoint, request, success + error responses, nullable vs optional,
  `additive` / `compatible-change` / `breaking-change`) per
  `skills/review-change/references/api-contracts.md`. A breaking change is an approval boundary.
- **Validation checkpoints** — where to run which layers.

## Test-strategy rules

- Required pre-implementation layers (`unit` / `component`, and relevant `integration`) must fail
  before production code changes. Capture that failing evidence — see the `tdd-slice` skill and
  `scripts/verify-red-before-production-change.mjs`.
- Required `e2e` may be authored after a vertical flow exists, but must pass before closeout.
- Use manual validation only where automation is not justified; record what is safely omitted and
  why.
- If acceptance criteria are too vague to validate, or the behaviour cannot be validated with the
  proposed matrix, stop and get the criteria tightened before implementing.

## Fast-track

A `trivial` classification skips the planning *ceremony* — a one-paragraph plan is enough — but
never skips the failing-test evidence or the applicable review lenses.
