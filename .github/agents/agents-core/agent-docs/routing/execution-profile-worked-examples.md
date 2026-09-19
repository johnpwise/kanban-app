# Execution Profile Worked Examples

## Purpose

Five realistic worked examples showing how an execution profile is selected for every dispatch, how
`reasoning_demand` and `delegation` are chosen **independently**, how profiles change across one
workflow, how escalation works without silent downgrade, and how a reviewer rework loop runs without
bypassing any gate.

Every step below is normative in shape only — field names and routing match the contracts in
[[execution-profile-schema]], [[execution-profile-policy]], [[reasoning-selection-policy]], and
`core-agent-execution-profile-defaults.md`. Scenario text is illustrative.

The whole slice runs in one primary context (the Delivery Engineer). "Activity" names the state or
inline skill (`feature-planning`, `tdd-slice`) or, where `delegation` is not `inline`, the separate
agent context. Each example uses a summary table:
`Step | Activity | Execution Profile | Reasoning Demand | Delegation | Escalated From | Rationale (one line)`.

**Reasoning demand** is how hard the thinking is (advisory model/effort at every level).
**Delegation** is whether a separate agent context does the work — `inline` by default, raised only
when the Delegation Gate in [[reasoning-selection-policy]] is met. Difficulty alone never raises
`delegation`.

None of these examples skip test-first sequencing, evidence gates, applicable review lenses, or the
commit/push gate.

---

## Example 1: Trivial bug fix

**Scenario:** "Pagination shows one fewer page than exists on the reports table." A reproducible,
single-file off-by-one error.

| Step | Activity | Execution Profile | Reasoning Demand | Delegation | Escalated From | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `intake / route` (Delivery Engineer) | `planning-routine` | `routine` | `inline` | — | Bounded, reproducible bug with clear acceptance criteria. |
| 2 | `plan` — `feature-planning` | `planning-routine` | `routine` | `inline` | — | Trivial fast-track: single-file calculation, no cross-module impact. |
| 3 | `test strategy` — `feature-planning` | `testing-routine` | `routine` | `inline` | — | One unit test covers the off-by-one boundary; other layers `N/A`. |
| 4 | `implement` — `tdd-slice` | `implementation-lightweight` | `lightweight` | `inline` | — | Deterministic one-line arithmetic correction against a pre-written failing unit test. |
| 5 | `correctness lens` — `review-change` | `review-routine` | `routine` | `inline` | — | Small, single-purpose diff, local impact, no interacting findings. |
| 6 | `commit + push` — `commit-and-push` | `delivery-lightweight` | `lightweight` | `inline` | — | Clean gate status, no explicit PR request. |

**What this demonstrates:** the whole workflow runs in one context. No dispatch is delegated,
because none meets the Delegation Gate — the review is a lens applied by an agent already looking at
the diff.

---

## Example 2: Routine feature

**Scenario:** "Add a CSV export button to the reports table." Well-understood shape, bounded to one
feature area.

| Step | Activity | Execution Profile | Reasoning Demand | Delegation | Escalated From | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `intake / route` (Delivery Engineer) | `planning-routine` | `routine` | `inline` | — | Clear acceptance criteria at intake. |
| 2 | `plan` — `feature-planning` | `planning-routine` | `routine` | `inline` | — | Non-trivial (button, CSV utility, tests) but bounded to one area. |
| 3 | `test strategy` — `feature-planning` | `testing-routine` | `routine` | `inline` | — | Standard `test_layer_matrix`: `unit` for formatting, `component` for the button, `e2e` `N/A`. |
| 4 | `implement` — `tdd-slice` | `implementation-routine` | `routine` | `inline` | — | Conventional button plus client-side CSV utility following established patterns. |
| 5 | `correctness lens` — `review-change` | `review-routine` | `routine` | `inline` | — | Small diff, no interacting findings, no drift. |
| 6 | `accessibility lens` — `review-change` | `review-routine` | `routine` | `inline` | — | Simple button control; accessibility lens applied in-context. |
| 7 | `commit + push` — `commit-and-push` | `delivery-lightweight` | `lightweight` | `inline` | — | Clean gate status. |

**What this demonstrates:** `routine` / `inline` is the correct default for the large majority of
dispatches in ordinary feature work. Multiple review disciplines apply, but as in-context lenses,
not delegated agents.

---

## Example 3: Architectural change

**Scenario:** "Introduce a shared `notifications` client-state boundary consumed by both the
dashboard and settings features." Ownership is not yet settled between two independently-owned areas,
and two lifting strategies look viable.

| Step | Activity | Execution Profile | Reasoning Demand | Delegation | Escalated From | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `intake / route` (Delivery Engineer) | `planning-routine` | `routine` | `inline` | — | The routing decision itself is routine. |
| 2 | `plan` — `feature-planning` | `planning-elevated` | `elevated` | `inline` | `planning-routine` | Scoping revealed a cross-feature ownership question with multiple viable approaches. |
| 3 | `architecture-advisor` | `architecture-elevated` | `elevated` | `inline` | — | New shared client-state boundary between two areas; costly to unwind. The primary context already holds both features' constraints, so the reasoning stays in-context at elevated effort. |
| 4 | `test strategy` — `feature-planning` | `testing-elevated` | `elevated` | `inline` | `testing-routine` | Matrix spans both consumers plus the new store; contested until the boundary decision landed. |
| 5 | `implement` — `tdd-slice` | `implementation-elevated` | `elevated` | `inline` | `implementation-routine` | Cross-module implementation of the approved boundary. |
| 6 | `state-ownership lens` — `independent-reviewer` | `review-elevated` | `elevated` | `independent` | — | A completed cross-feature shared-state change; an isolated review by a fresh context materially raises confidence. |
| 7 | `correctness lens` — `review-change` | `review-routine` | `routine` | `inline` | — | Remaining diff is contained and follows the approved boundary. |
| 8 | `commit + push` — `commit-and-push` | `delivery-lightweight` | `lightweight` | `inline` | — | Clean gate status. |

Fully expanded metadata for step 3:

```
Execution Profile: architecture-elevated
Capability: analysis
Reasoning Demand: elevated
Delegation: inline
Risk: high
Scope: cross-module
Reversibility: reversible-with-effort
Verification: review-backed
Rationale: new shared client-state boundary between two independently-owned areas; the primary agent already holds both features' constraints, so weighed the two lifting strategies in-context at elevated effort rather than delegating.
```

**What this demonstrates:** an architecture-sensitive workflow drives the middle into `elevated`
reasoning while staying `inline` — the difficulty is handled by effort, not by a fresh context that
would have to relearn both features. Exactly one dispatch is delegated (`independent`), and only
because an isolated second opinion on the finished shared-state change adds real confidence.

---

## Example 4: Automatic mid-dispatch escalation

**Scenario:** "Validation error message doesn't show for an empty email field." Initially scoped as
a bounded validation-message fix; the root cause is discovered mid-implementation to be in shared
authentication middleware.

| Step | Activity | Execution Profile | Reasoning Demand | Delegation | Escalated From | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `intake / route` (Delivery Engineer) | `planning-routine` | `routine` | `inline` | — | Reproducible defect with an apparently bounded cause. |
| 2 | `plan` — `feature-planning` | `planning-routine` | `routine` | `inline` | — | Trivial fast-track: expected single-DTO validation fix. |
| 3 | `test strategy` — `feature-planning` | `testing-routine` | `routine` | `inline` | — | Standard unit coverage for the validation path as scoped. |
| 4 | `implement` — `tdd-slice` | `implementation-routine` → `implementation-elevated` | `routine` → `deep` | `inline` | `implementation-routine` | Root cause traced into shared authentication middleware stripping the email field before validation; reasoning raised to `deep`, but kept in-context — the agent has already reconstructed the request path. |
| 5 | `correctness lens` — `independent-reviewer` | `review-elevated` | `elevated` | `independent` | `review-routine` | Fix touches shared authentication middleware; an isolated review of the completed change adds confidence on a security-sensitive path. |
| 6 | `commit + push` — `commit-and-push` | `delivery-lightweight` | `lightweight` | `inline` | — | Commit mechanics unaffected by the upstream escalation. |

Fully expanded metadata for step 4 (the escalation moment):

```
Execution Profile: implementation-elevated
Capability: code-generation
Reasoning Demand: deep
Delegation: inline
Risk: high
Scope: cross-module
Reversibility: hard-to-reverse
Verification: test-backed
Rationale: root cause is in shared authentication middleware, not the scoped DTO layer; raised reasoning from routine to deep because the interaction is subtle, but kept inline — the failing request path is already reconstructed in this context and a fresh agent would rebuild it.
Escalated From: implementation-routine
Escalation Reason: root cause traced into shared authentication middleware affecting all authenticated requests, not the scoped validation-message rendering.
```

**What this demonstrates:** discovering that a problem is harder raises `reasoning_demand` (here
straight to `deep`) and is recorded with `escalated_from` / `escalation_reason` — but it does **not**
trigger delegation. The escalation is scoped to the dispatch whose difficulty actually changed;
the commit step does not inherit it.

---

## Example 5: Reviewer rework loop

**Scenario:** "Add inline editing to the product-name field in the settings table." The first
implementation pass lifts local edit state into the shared `appStore` unnecessarily, creating a
blocking architectural-drift finding.

| Step | Activity | Execution Profile | Reasoning Demand | Delegation | Escalated From | Rationale |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `intake / route` (Delivery Engineer) | `planning-routine` | `routine` | `inline` | — | Bounded feature shape at intake. |
| 2 | `plan` — `feature-planning` | `planning-routine` | `routine` | `inline` | — | Non-trivial but bounded: inline-edit state, validation, one persistence call. |
| 3 | `test strategy` — `feature-planning` | `testing-routine` | `routine` | `inline` | — | Standard `test_layer_matrix` for a bounded UI change. |
| 4 | `implement` (first pass) — `tdd-slice` | `implementation-routine` | `routine` | `inline` | — | Conventional inline-edit pattern, expected local component state. |
| 5 | `state-ownership lens` — `review-change` | `review-routine` | `routine` | `inline` | — | Narrow local-vs-lifted decision at first glance. Passes. |
| 6 | `correctness lens` — `review-change` (finding) | `review-elevated` | `elevated` | `inline` | `review-routine` | Diff shows local edit-state lifted into shared `appStore`, creating cross-component coupling. Returns `changes-required` (blocking). |
| 7 | `re-entry` (Delivery Engineer) | `planning-routine` | `routine` | `inline` | — | Routes scoped rework back into `tdd-slice` per the blocking finding. |
| 8 | `implement` (rework) — `tdd-slice` | `implementation-elevated` | `elevated` | `inline` | — | Corrective work re-evaluates a state-ownership decision, not a mechanical patch; assigned `elevated` directly. |
| 9 | `correctness lens` — `review-change` (re-run) | `review-routine` | `routine` | `inline` | — | Rework resolved the drift; diff now small and single-purpose. Passes. |
| 10 | `state-ownership lens` — `review-change` (re-run) | `review-routine` | `routine` | `inline` | — | Re-run because `capability_owners.shared_client_state_owner` scope changed during rework. Confirms pass. |
| 11 | `commit + push` — `commit-and-push` | `delivery-lightweight` | `lightweight` | `inline` | — | Clean gate status after both lenses re-ran green. |

**What this demonstrates:** a blocking reviewer finding is never waved through and rework never skips
the lens that found the problem — but the whole loop runs in one context. The finding raises
`reasoning_demand` for the dispatches whose reasoning genuinely got harder (6 and 8) and drops back
to `routine` once the drift is resolved. No dispatch is delegated; nothing here meets the Delegation
Gate.

---

## Cross-example takeaways

- `routine` / `inline` dominates ordinary work. `lightweight` appears for mechanical steps.
  `elevated` / `deep` appear only when a dispatch's own reasoning difficulty earns it, recorded in
  `rationale`.
- `reasoning_demand` and `delegation` are chosen separately. Raising one never raises the other.
  Most `elevated` and `deep` dispatches stay `inline`, because the primary agent already holds the
  context the hard reasoning needs.
- `delegation` is raised only by the Delegation Gate: genuine independence, material second-opinion
  value, context pollution, or an unresolved specialised decision. File count, module count, and
  "non-trivial" are explicitly not reasons.
- Escalation is always recorded (`escalated_from` + `escalation_reason`) and never blanket-applied
  to unrelated downstream dispatches.
- No example skips a gate — execution-profile routing changes *how much reasoning effort* a dispatch
  gets and *whether a separate context does it*, never *whether* a gate runs.
