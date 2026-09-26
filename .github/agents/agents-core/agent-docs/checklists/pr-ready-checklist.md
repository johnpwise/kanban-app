# pr-ready-checklist.md (core baseline)

Each stack pack's own `agent-docs/checklists/pr-ready-checklist.md` inherits the relevant section
below and states only its stack-specific additions/extensions.

## Frontend stacks — shared baseline (react, vue, nextjs)

Use this checklist before a frontend change is considered PR-ready.

### Behavior
- requested behavior is implemented
- success path is verified
- loading, error, empty, and disabled states are handled where relevant
- obvious edge cases are covered

### Type safety
- no `any`
- no broad casts masking boundary issues
- nullable and optional paths are narrowed intentionally

### State and architecture
- state is owned at the smallest sensible level
- remote data is not duplicated into client state without cause
- components are not performing transport concerns directly

### Tests
- `test_layer_matrix` (`unit`, `component`, `integration`, `e2e`) is explicitly marked `required` or `N/A` with rationale
- `required_preimplementation_tests` (`unit`/`component` and relevant `integration`) were written as failing tests before production code changes
- `preimplementation_failing_test_evidence` is recorded in handoff/checkpoint artifacts
- non-trivial logic has behavior-focused coverage
- tests avoid brittle implementation coupling
- component tests use explicit AAA annotations: `// Arrange`, `// Act`, `// Assert`
- AAA sections are separated by exactly one blank line and stay in strict order
- test names describe scenario and expected outcome
- required `e2e_status` is `passing` before closeout
- any full-suite failure outside this change's own behaviour was reproduced once against the merge-base; a failure present on the base ref is recorded as pre-existing (base ref, command, result) and was not repaired here
- commit authoring has completed, commit SHA(s) are recorded, and push-success evidence (command + remote + branch/ref) is recorded
- if a PR was explicitly requested during this workflow, PR authoring has completed with a live PR URL and PR number recorded in workflow artifacts; if no PR was requested, this is not required for closeout
- closeout cleanup runs only after commit push evidence is complete (plus live PR evidence, if a PR was explicitly requested)
- push failures are routed as `blocked` or `awaiting-approval` (not closeout-ready); a failed explicitly-requested PR blocks only that request, never workflow closeout

### Review hygiene
- diff is scoped
- unrelated cleanup is excluded
- new abstractions were introduced only if they earned their cost
- `review-lens-manifest.json` validates against the completed diff/slice spec and the closeout record links its path/hash
- skipped lenses retain machine reason codes and only `loadReferences` were loaded
- the always-on correctness lens (`skills/review-change/references/correctness.md`) is not `changes-required`
- every manifest-included lens is complete with no blocking findings
- when a review-lens finding triggered rework, the rework and the applicable lens reruns are complete

### Accessibility / UX
- controls are semantic
- keyboard path works
- labels and status messages are clear
- focus behavior is acceptable for the flow
- when the diff changes interactive UI, the `skills/review-change/` accessibility lens is complete; for a pure logic/util/test-only diff it is correctly skipped

## Backend stacks — shared baseline (node-express, node-express-ts)

Use this before closeout of backend work.

- behavior matches the request
- `capability_owners` includes `transport_boundary_owner`, `service_boundary_owner`, and `persistence_boundary_owner`
- route/service/persistence boundaries remain clear
- status codes and error shapes are consistent
- `test_layer_matrix` (`unit`, `component`, `integration`, `e2e`) is explicitly marked `required` or `N/A` with rationale
- `required_preimplementation_tests` for all `test_layer_matrix` layers marked `required` were written as failing tests before production code changes
- `preimplementation_failing_test_evidence` is recorded in handoff/checkpoint artifacts
- tests cover happy path and relevant unhappy paths
- required `e2e_status` is `passing` before closeout
- any full-suite failure outside this change's own behaviour was reproduced once against the merge-base; a failure present on the base ref is recorded as pre-existing (base ref, command, result) and was not repaired here
- commit authoring has completed, commit SHA(s) are recorded, and push-success evidence (command + remote + branch/ref) is recorded
- if a PR was explicitly requested during this workflow, PR authoring has completed with a live PR URL and PR number recorded in workflow artifacts; if no PR was requested, this is not required for closeout
- closeout cleanup runs only after commit push evidence is complete (plus live PR evidence, if a PR was explicitly requested)
- push failures are routed as `blocked` or `awaiting-approval` (not closeout-ready); a failed explicitly-requested PR blocks only that request, never workflow closeout
- logs/error handling are adequate for meaningful failures
- no unrelated cleanup
- lint/build/test expectations are satisfied
