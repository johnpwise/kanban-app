# model-routing-policy.md (core baseline)

## Purpose

This document defines the execution-profile routing baseline shared across stack packs, using the
shared vocabulary in `agent-docs/routing/execution-profile-schema.md`,
`agent-docs/routing/execution-profile-policy.md`, and
`agent-docs/routing/reasoning-selection-policy.md`. Each stack pack's own
`agent-docs/routing/model-routing-policy.md` inherits the relevant section below and adds only its
stack-specific routing rules, lens escalation criteria, and lens set.

`reasoning_demand` (how hard the thinking is) and `delegation` (whether a separate agent context
does the work) are **independent**. Every escalation below raises `reasoning_demand` only; it runs
in the primary context unless the Delegation Gate in
`agent-docs/routing/reasoning-selection-policy.md` is separately met.

---

## Frontend stacks — shared baseline (react, vue, nextjs)

Baseline:
- use `routine` reasoning demand for straightforward, localized review or translation tasks
- use `elevated` reasoning demand for ambiguous, cross-boundary, or high-impact decisions
- use `deep` reasoning demand only for the hardest subset — subtle, tightly-coupled, or
  severe-consequence reasoning

### Global Routing Rules

Use **`routine`** reasoning demand when all are true:
- scope is narrow and single-purpose
- the change impact is local
- behavior is already clear
- no approval-boundary decision is needed

Use **`elevated`** reasoning demand when any are true:
- the request is ambiguous or underspecified
- state ownership is unclear
- API contract or nullability is unclear
- accessibility involves modal, focus, or validation complexity
- the test matrix spans async races or multiple UI states
- `test_layer_matrix` decisions (`unit`, `component`, `integration`, `e2e`) are unclear or
  contested
- `preimplementation_failing_test_evidence` is missing or contradictory

A review lens applied by the agent that wrote the code is `delegation: inline`; use
`delegation: independent` only when an isolated second opinion on a completed diff materially
raises confidence.

### Review lens defaults (`skills/review-change/`)

Every lens defaults to `review-routine` (`reasoning_demand: routine`), applied inline. Raise a lens
to `review-elevated` (`reasoning_demand: elevated`) only when that lens's own reasoning is hard:

- **correctness lens** — the diff is large, multiple interacting findings exist, state ownership is
  questionable, architectural drift is evident, or test-first evidence gates fail (missing
  `test_layer_matrix`, missing `preimplementation_failing_test_evidence`, or required `e2e_status`
  not passing at closeout).
- **accessibility lens** — dialogs or overlays, multi-step forms or validation flows, non-trivial
  focus restoration, or complex async recovery paths.
- **state-ownership lens** — start at `review-elevated` when ownership is contested or spans
  multiple features; drop to `review-routine` for narrow local-vs-lifted decisions with little
  downstream impact.

### api-contracts lens (`skills/review-change/references/api-contracts.md`)
Contract modelling at plan time and contract review in the diff. Default `architecture-elevated`
(`reasoning_demand: elevated`); drop to `planning-routine` only for additive field updates with
stable transport shapes or simple request/response extensions with no branching semantics.

### Escalation Criteria (Cross-Cutting)

These conditions require the Delivery Engineer to escalate the relevant lens or agent (per
`agent-docs/routing/reasoning-selection-policy.md`) regardless of where they are first observed:

- **Shared client state ownership is contested or spans multiple features** -> raise the
  `review-change` state-ownership lens to `review-elevated` and the implementation step
  (`tdd-slice`) to `implementation-elevated`; treat
  `capability_owners.shared_client_state_tier: cross_feature` as a corroborating signal.
- **API contract change affects other consumers or has unclear backward compatibility** -> raise
  the `review-change` api-contracts lens to `review-elevated` and consult `architecture-advisor`
  at `architecture-elevated`.
- **Accessibility complexity involves modal/focus management or multi-step validation flows** ->
  raise the `review-change` accessibility lens to `review-elevated`.
- **The change is on a security, authorization, data-boundary, or cross-feature shared-state
  path** -> the Delegation Gate is met; delegate the review to `Independent-Reviewer`.

Whoever observes one of these conditions records it in `Escalation Reason` and must not silently
continue at a lower profile.

---

## Backend stacks — shared baseline (node-express, node-express-ts)

The shared core pack remains the workflow backbone. Backend review and API contract modelling are
applied inline via `skills/review-change/` and its `references/`. `deep` reasoning demand is for
the hardest subset only.

### Default routing

- Use the shared core agents first for intake, planning, implementation, and generic testing
  strategy.
- Use `agent-docs/workflows/feature-workflow-routing.md` for trigger-aware feature routing and
  `agent-docs/workflows/bug-workflow-routing.md` for trigger-aware bug routing.
- If `New Feature` or `Bug Fix` trigger text is missing at intake, request reissue before dispatch.
- Run the `skills/review-change/` lens for a concern when the diff changes backend contracts,
  boundaries, persistence behavior, or operational behavior.
- Do not route implementation closeout without explicit capability and test evidence
  (`capability_owners`, `test_layer_matrix`, `preimplementation_failing_test_evidence`, and
  `e2e_status`).

### Escalation Criteria (Cross-Cutting)

These conditions require the Delivery Engineer to escalate the relevant lens or agent (per
`agent-docs/routing/reasoning-selection-policy.md`) regardless of where they are first observed:

- **Authentication or authorization changes** -> escalate the implementation step (`tdd-slice`) to
  `implementation-elevated`; escalate `architecture-advisor` to `architecture-elevated` if
  boundaries change.
- **Transactional or multi-record write changes** -> escalate the implementation step
  (`tdd-slice`) to `implementation-elevated`.
- **Schema or data migrations** -> escalate the implementation step (`tdd-slice`) to
  `implementation-elevated`; escalate `architecture-advisor` to `architecture-elevated` for
  migration-shaped design.
- **Messaging/event/queue integration changes** (producer or consumer behavior, message schema,
  delivery guarantees) -> escalate the implementation step (`tdd-slice`) to
  `implementation-elevated`.
- **Observability gaps that could mask a production incident** -> escalate the implementation step
  (`tdd-slice`) to `implementation-elevated`.
- **API contract change with unclear backward compatibility** -> raise the `review-change`
  api-contracts lens to `review-elevated`; consult `architecture-advisor` at
  `architecture-elevated` if the change affects other consumers.
- **The change is on a security, authorization, data-boundary, or transaction path** -> the
  Delegation Gate is met; delegate the review to `Independent-Reviewer`.

Whoever observes one of these conditions records it in `Escalation Reason` and must not silently
continue at a lower profile.

### Review lens defaults (`skills/review-change/`)

Every lens defaults to `review-routine` (`reasoning_demand: routine`), applied inline. Raise a lens
to `review-elevated` (`reasoning_demand: elevated`) only when that lens's own reasoning is hard:

- **correctness lens** — the diff is large, spans multiple backend layers, or test-first evidence
  gates are incomplete at closeout.
- **persistence lens** — start at `review-elevated`; transactional-correctness review is never
  routine. On a transaction boundary, concurrency hazard, or migration-shaped change, escalate the
  implementation step (`tdd-slice`) to `implementation-elevated` and, if structural,
  `architecture-advisor` to `architecture-elevated`.
- **error/observability lens** — error handling spans external services, retries/idempotency, or
  messaging/event delivery guarantees; when an observability gap could mask a production incident,
  escalate the implementation step (`tdd-slice`) to `implementation-elevated`.
