# bug-intake-baseline.prompt.md (core baseline)

Each stack pack's own `<stack>-bug-intake.prompt.md` (frontend) or `api-bug-intake.prompt.md`
(backend) inherits this baseline and states only its stack-specific delta.

## Shared intake policy (all stacks)

- Bug intake requires the request to start with `Bug Fix`.
- If the trigger is missing, do not dispatch a bug workflow; request a correctly triggered reissue first.
- After trigger validation, normalize the report into explicit behavior, repro, and validation expectations, then plan and deliver the fix in a single primary context (repro → RED → GREEN → REFACTOR → verify → review lenses → commit). Delegate to a separate agent context only when the Delegation Gate is met.
- Under workflow triggers, use fail-closed behavior: no implementation edits before workflow artifacts are bootstrapped and the required RED evidence exists.

## Reusable trigger template

```text
Use agent spec: Delivery-Engineer
Bug Fix
<problem summary>
```

## Early routing hints — shared framing

Do all of this inline in the primary context unless the Delegation Gate is met
(`.github/agents/agents-core/agent-docs/routing/reasoning-selection-policy.md`):

- planning — complexity classification and increment sequencing
- test strategy — `test_layer_matrix` and pre-implementation failing-test design
- review lenses, diff-classified (see `agent-docs/workflows/bug-workflow-routing.md`): correctness always; every other lens only when the diff touches it
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

- bug summary and user-visible impact
- affected screens, routes, feature areas, and likely modules
- current behavior (actual) vs expected behavior
- reproducibility and repro steps
- frequency and affected user segment
- relevant logs, screenshots, traces, or error signatures
- expected loading, error, empty, disabled, and recovery states
- `capability_owners.local_ui_state_owner` candidate
- `capability_owners.shared_client_state_owner` candidate
- `capability_owners.shared_client_state_tier` candidate (`subtree` | `cross_feature`) when shared client ownership is in scope
- remote data/contracts involved and suspected API boundaries
- forms, keyboard flow, focus, or accessibility-sensitive interactions
- complexity signals indicating localized (`trivial`) vs cross-boundary (`non-trivial`) scope
- `test_layer_matrix` (`unit`, `component`, `integration`, `e2e`) with `required`/`N/A` rationale
- `required_preimplementation_tests` for `unit`/`component` and relevant `integration`
- `preimplementation_failing_test_evidence` expectations
- `e2e_status` plan (`planned` before implementation, `passing` before closeout when required)

### Early routing hints — frontend addition
- state-ownership when state location is unclear; contract modelling when nullability/error-shape assumptions are unclear

### Intake output shape

Return:

- bug summary
- actual behavior
- expected behavior
- reproducible steps and evidence summary
- scope and assumptions
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

- bug summary and user/system impact
- current behavior (actual) vs expected behavior
- reproducibility, repro steps, and frequency
- affected routes/endpoints, modules, and likely backend layers
- relevant error signatures, logs, traces, or failure evidence
- auth/permissions and validation behaviors involved
- `capability_owners.transport_boundary_owner` candidate
- `capability_owners.service_boundary_owner` candidate
- `capability_owners.persistence_boundary_owner` candidate
- downstream dependency or persistence involvement
- complexity signals indicating localized (`trivial`) vs cross-boundary (`non-trivial`) scope
- `test_layer_matrix` (`unit`, `component`, `integration`, `e2e`) with `required`/`N/A` rationale
- `required_preimplementation_tests` for layers marked `required` in `test_layer_matrix`
- `preimplementation_failing_test_evidence` expectations
- `e2e_status` plan (`planned` before implementation, `passing` before closeout when required)

### Early routing hints — backend addition
- contract modelling, route/service/persistence boundary, persistence/transaction, and error/observability checks on their respective concerns

### Intake output shape

Return:

- bug summary
- actual behavior
- expected behavior
- reproducible steps and evidence summary
- scope and assumptions
- complexity signals and constraints for planner classification
- `capability_owners.transport_boundary_owner`
- `capability_owners.service_boundary_owner`
- `capability_owners.persistence_boundary_owner`
- likely contract surface
- `test_layer_matrix` (`required`/`N/A` + rationale)
- `required_preimplementation_tests`
- `preimplementation_failing_test_evidence` expectations
- `e2e_status` plan and closeout expectation
- which diff-triggered review lenses apply, and rework-loop expectations
- post-review closeout expectations (`commit-and-push` skill -> optional `create-develop-pr` skill on explicit request -> `delivery-engineer` closeout reentry)
- recommended next agent
