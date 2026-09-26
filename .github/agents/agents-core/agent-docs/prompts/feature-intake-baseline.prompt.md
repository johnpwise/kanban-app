# feature-intake-baseline.prompt.md (core baseline)

Each stack pack's own `<stack>-feature-intake.prompt.md` (frontend) or `api-feature-intake.prompt.md`
(backend) inherits this baseline and states only its stack-specific delta.

## Shared intake policy (all stacks)

- Feature intake requires the request to start with `New Feature`.
- If the trigger is missing, do not dispatch a feature workflow; request a correctly triggered reissue first.
- Before creating workflow artifacts or editing tests/production code, complete the mandatory work-branch preflight: require a clean tree, fetch and `git pull --ff-only origin develop`, derive a Git-safe kebab-case slug from the normalized summary, reject local/remote collisions, and create `feature/<slug>` from synchronized `develop`. Stop on any failure; never merge, rebase, reset, discard work, reuse/auto-suffix a branch, or push an empty branch.
- After trigger validation, normalize the request, then plan and deliver it in a single primary context (plan → BDD → RED → GREEN → REFACTOR → verify → review lenses → commit). Delegate to a separate agent context only when the Delegation Gate is met.
- Persist normalized intake and planning in `.agent-workflows/<workflow_id>/slice-spec.json` per
  `agent-docs/workflows/canonical-slice-spec.md`; later output references path/revision/hash and
  never repeats canonical fields.
- Under workflow triggers, use fail-closed behavior: no implementation edits before workflow artifacts are bootstrapped and the required RED evidence exists.

## Reusable trigger template

```text
Use agent spec: Delivery-Engineer
New Feature
<feature summary>
```

## Early routing hints — shared framing

Do all of this inline in the primary context unless the Delegation Gate is met
(`.github/agents/agents-core/agent-docs/routing/reasoning-selection-policy.md`):

- planning — complexity classification and increment sequencing
- test strategy — `test_layer_matrix` and pre-implementation failing-test design
- review lenses, conservative manifest-classified (see `agent-docs/workflows/feature-workflow-routing.md`): correctness always; uncertainty includes; model additions only
- commit + push via the `commit-and-push` skill once the applicable lenses pass

Use a separate agent context only for an isolated review of an authorization / shared-state /
transaction-boundary change (`delegation: independent`), or genuinely independent parallel
workstreams (`delegation: parallel`).

---

## Frontend stacks — shared baseline (react, vue, nextjs)

Intake policy also includes: for new/updated frontend slices, when
`capability_owners.shared_client_state_owner` is present, require
`capability_owners.shared_client_state_tier` (`subtree` | `cross_feature`).

### Capture
- user-visible behavior requested
- affected screens, routes, or feature areas
- expected loading, error, empty, disabled, and success states
- `capability_owners.local_ui_state_owner` candidate
- `capability_owners.shared_client_state_owner` candidate
- `capability_owners.shared_client_state_tier` candidate (`subtree` | `cross_feature`) when shared client ownership is in scope
- remote data involved
- forms, keyboard flow, or accessibility-sensitive interactions
- whether the change appears local, subtree-wide, or cross-page
- `test_layer_matrix` (`unit`, `component`, `integration`, `e2e`) with `required`/`N/A` rationale
- `required_preimplementation_tests` for `unit`/`component` and relevant `integration`
- `preimplementation_failing_test_evidence` expectations
- `e2e_status` plan (`planned` before implementation, `passing` before closeout when required)
- overlay tool-mapping impact (does repo overlay need updates for capability->tool mapping?)
- complexity signals for planner classification (`trivial` or `non-trivial`)

### Early routing hints — frontend addition
- state-ownership when state location is unclear; contract modelling when transport shapes or nullability are unclear

### Intake output shape
Populate these canonical slice-spec fields, then return only the path/revision/hash plus unresolved
questions:
- feature summary
- scope
- assumptions
- complexity signals and constraints for planner classification
- `capability_owners.local_ui_state_owner`
- `capability_owners.shared_client_state_owner`
- `capability_owners.shared_client_state_tier` (`subtree` | `cross_feature`) when `shared_client_state_owner` is present
- likely contract surface
- `test_layer_matrix` (`required`/`N/A` + rationale)
- `required_preimplementation_tests`
- `preimplementation_failing_test_evidence` expectations
- `e2e_status` plan and closeout expectation
- which diff-triggered review lenses apply, and rework-loop expectations
- recommended next agent

## Backend stacks — shared baseline (node-express, node-express-ts)

### Capture
- feature summary and business intent
- affected routes/endpoints and user-facing/API-facing behavior
- auth/permissions and validation rules in scope
- affected backend layers (transport, service, persistence, integrations)
- `capability_owners.transport_boundary_owner` candidate
- `capability_owners.service_boundary_owner` candidate
- `capability_owners.persistence_boundary_owner` candidate
- downstream dependencies, side effects, and reliability constraints
- complexity signals indicating localized (`trivial`) vs cross-boundary (`non-trivial`) scope
- backward-compatibility expectations and migration impact (if any)
- `test_layer_matrix` (`unit`, `component`, `integration`, `e2e`) with `required`/`N/A` rationale
- `required_preimplementation_tests` for layers marked `required` in `test_layer_matrix`
- `preimplementation_failing_test_evidence` expectations
- `e2e_status` plan (`planned` before implementation, `passing` before closeout when required)
- overlay tool-mapping impact (does repo overlay need updates for capability->tool mapping?)

### Intake output shape
Populate these canonical slice-spec fields, then return only the path/revision/hash plus unresolved
questions:
- feature summary
- business intent
- scope and assumptions
- complexity signals and constraints for planner classification
- `capability_owners.transport_boundary_owner`
- `capability_owners.service_boundary_owner`
- `capability_owners.persistence_boundary_owner`
- likely contract surface and compatibility posture
- `test_layer_matrix` (`required`/`N/A` + rationale)
- `required_preimplementation_tests`
- `preimplementation_failing_test_evidence` expectations
- `e2e_status` plan and closeout expectation
- which diff-triggered review lenses apply, and rework-loop expectations
- post-review closeout expectations (`commit-and-push` skill -> optional `create-develop-pr` skill on explicit request -> `delivery-engineer` closeout reentry)
- recommended next agent
