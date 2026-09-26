# Agents Core Pack - AGENTS.md

This document defines reusable core workflow guidance that can be inherited by stack packs and repo overlays.

Stack packs should add stack-specific policy. Repo-local `AGENTS.md` files should add project facts, exceptions, and approval boundaries.

## 1. Scope

This core pack targets stack-neutral delivery of one slice at a time — one primary context (the Delivery Engineer) owning it end-to-end — for:

- feature delivery
- bug triage and fixes
- refactor planning and execution
- review and validation routing

This pack is appropriate when:
- delivery is test-first, incremental, and reversible
- continuity and slice state need an explicit owner
- approvals, assumptions, and deferrals must stay visible across steps
- a decision occasionally warrants a second agent context (architecture advice, an independent review)

## 2. Defaults

Unless a stack or repo overlay says otherwise, agents should assume:

- `delivery-engineer` (the Delivery Engineer, alias `Delivery-Engineer`) is the active workflow owner and does the work in one primary context
- every feature and bug request is planned inline with `skills/feature-planning/` (complexity classification, test strategy, capability owners) before any test or production code
- stack overlays may define feature-intake command triggers; when present, `delivery-engineer` should enforce them before feature dispatch
- every valid `New Feature` or `Bug Fix` intake must complete the mandatory work-branch preflight before any workflow artifact, test, or production-file write: synchronize local `develop` with `origin/develop` using `git pull --ff-only origin develop`, then create a new `feature/<derived-kebab-case-slug>` or `bugfix/<derived-kebab-case-slug>` branch from it
- the work-branch preflight is fail-closed: require a clean tree, a reachable `origin/develop`, a usable slug derived from the normalized request, and no local or remote branch-name collision; never merge, rebase, reset, discard work, reuse a colliding branch, auto-suffix it, or push an empty branch
- when a stack overlay defines explicit intake triggers, triggered requests should run in fail-closed mode until required workflow artifacts are persisted by the workflow owner
- every new feature or bug workflow has one canonical `.agent-workflows/<workflow_id>/slice-spec.json`; intake creates it, planning/RED/verification progressively populate it, and other workflow state references its path/revision/hash instead of restating objective, criteria, scope, provenance, approvals, owners, matrix, increments, expected RED evidence, or verification
- canonical slice-spec provenance entries and approval decisions are append-only; identity, approval boundaries, revisions, and workflow status must not regress; legacy workflows without a slice spec remain readable but new workflows may not use that omission
- in fail-closed mode, no implementation edits are allowed before required workflow artifacts exist
- in fail-closed mode, the first response should report workflow ownership and routing state, not direct implementation
- in fail-closed mode, if trigger format or required routing metadata is incomplete, request a correctly formatted reissue before code changes
- bug requests are classified `trivial` / `non-trivial` during inline `skills/feature-planning/` before implementation
- a trivial fast-path skips planning ceremony only when boundaries are clear, and must still enforce test-first/evidence/review gates
- every workflow record uses `agent-docs/templates/handoff-template.md`: a compact **Step Record** for same-context steps, a full **Cross-Context Handoff Package** only when a step is dispatched to a separate agent context or a fresh resume window
- Slice 1 ledger shadow mode is additive: after persisting each existing Markdown workflow artifact, append the equivalent structured event to `.agent-workflows/<workflow_id>/ledger.jsonl` with `scripts/workflow-ledger.mjs`; derive `ledger-views/` from that ledger and record discrepancies without deleting or weakening the compatibility artifact
- default routing returns to `delivery-engineer.agent.md` unless a cross-context handoff explicitly overrides `Return To Agent`
- a copy/paste-ready completion/bootstrap block (with artifact path and continue-workflow line) is emitted only for a cross-context dispatch or a workflow-owner reentry state; in-context steps just continue
- worker routing metadata (`next_agent_alias`, `workflow_status`, `reentry_reason`) controls happy-path chaining; `delivery-engineer` enforces required gate order on reentry
- the delivery engineer commits + pushes via the portable `commit-and-push` skill rather than duplicating its procedure; success requires commit SHA evidence plus successful `git push` evidence (command, remote, and branch/ref)
- a workflow reaches `ready-for-closeout` once commit-and-push succeeds; PR creation is a separate, explicitly requested step and is never a closeout precondition
- a PR is created only when the user makes an explicit, separate PR request recognised per the shared trigger-recognition standard, via the `create-develop-pr` skill (or the repo/stack-defined PR skill); it is never automatic after commit-and-push
- when explicitly requested, PR creation succeeds only with a live PR URL and PR number; artifact-only PR output is not success
- if push fails, routing must return `blocked` or `awaiting-approval`; `ready-for-closeout` is not allowed
- if an explicitly requested PR creation fails, routing must return `blocked` or `awaiting-approval` for that request without reopening an already closeout-ready workflow
- each step should use the smallest competent next specialist
- smallest-step routing applies only after required workflow intake/bootstrap gates are satisfied; it never overrides fail-closed trigger handling or lets implementation start before workflow artifacts exist
- work should be sliced for small, reviewable, reversible diffs
- assumptions, approvals, and deferrals must be explicit
- no hidden scope expansion
- no new dependencies without dependency review and approval
- ownership and validation policy should be expressed in capability terms, not package names
- capability fields are mandatory for implementation slices: `capability_owners`, `test_layer_matrix`
- test-first sequencing is mandatory for implementation slices
- each slice must define `test_layer_matrix` (`unit`, `component`, `integration`, `e2e`) with `required` or `N/A` plus rationale
- `required_preimplementation_tests` (`unit`/`component` and relevant `integration`) must exist and fail before production code changes
- `e2e_status` must be tracked as `planned` -> `authored` -> `passing`; required `e2e_status` must be `passing` before closeout
- handoffs and checkpoints must record `test_layer_matrix`, `required_preimplementation_tests`, `preimplementation_failing_test_evidence`, and `e2e_status`
- implementation handoffs must include runtime/compatibility audit coverage and explicit compatibility impact notes when applicable
- stack packs should define required `capability_owners` keys for their domain
- frontend stacks using `capability_owners.shared_client_state_owner` should require `capability_owners.shared_client_state_tier` (`subtree` | `cross_feature`) for new/updated frontend slices
- repo-local overlays should map stack-defined capabilities and test layers to concrete packages and tooling for that repository
- review is diff-classified through `.agent-workflows/<workflow_id>/review-lens-manifest.json`: one always-on correctness lens plus only the lenses the completed diff and canonical slice spec trigger (each stack pack owns its lens inventory); uncertain classification includes the lens, the model may add but never remove lenses, skipped lenses carry machine reason codes, and only `loadReferences` are loaded; the closeout step record links the manifest and blocking findings trigger scoped rework loops
- a review lens is `delegation: inline` by default; raise `delegation` only when the Delegation Gate is met
- every dispatch and handoff must carry Execution Profile Metadata (`execution_profile`, `capability`, `reasoning_demand`, `delegation`, `risk`, `scope`, `reversibility`, `verification`, `rationale`) per `agent-docs/routing/execution-profile-schema.md`; `reasoning_demand` is one of four levels — `lightweight`, `routine`, `elevated`, `deep` — `delegation` is one of `inline`, `advisor`, `independent`, `parallel`, and profiles are selected per-dispatch and may vary across a workflow
- resolve that semantic metadata once at each phase boundary with `scripts/execution-profile-router.mjs`; persist the compact profile ID in normal-path records, reuse the cache until new risk evidence appears, and emit free-form rationale only for escalation, exception, acknowledged downgrade, or non-inline delegation
- `reasoning_demand` and `delegation` are independent decisions: `reasoning_demand` is how hard the thinking is, `delegation` is whether a separate agent context does it. Difficulty, file count, and module count never by themselves raise `delegation` — see the Delegation Gate in `agent-docs/routing/reasoning-selection-policy.md`
- `reasoning_demand` is advisory model/effort at every level and never by itself forces a separate context; `delegation: inline` (the default) runs in the primary context, and `advisor`/`independent`/`parallel` are dispatched through the `Agent` tool with each subagent's model set from its own `reasoning_demand`, per the Realization Rule in `agent-docs/routing/reasoning-selection-policy.md`
- a specialist may escalate its own dispatch's `reasoning_demand` or propose raising `delegation` with recorded `escalated_from`/`escalation_reason`, but must never silently downgrade an assigned `reasoning_demand` or `delegation` without explicit recorded rationale and re-acknowledgement
- the legacy `Reasoning Mode: Fast|High` contract is deprecated compatibility input only; do not validate against it, and reissue any pre-update artifact still using it with a valid Execution Profile Metadata block before continuing

### Explicit trigger-recognition standard

Every action gated behind an "explicit request" (PR authoring today; release/hotfix lifecycle actions where a repo or stack overlay adds them) uses one shared recognition rule instead of a per-specialist judgment call:

- A trigger fires only on a clear, present-tense, imperative instruction that names the specific action (for example "create develop PR", "open a PR").
- Hedged, past-tense, conditional, or exploratory phrasing (for example "I think we should open a PR soon", "we'll need a PR eventually") must not fire the action.
- If a message is ambiguous, ask the user to confirm the exact action rather than guessing or silently proceeding.
- This rule is authoritative across `agents-core` and all stack/repo overlays; overlays must not define a different or looser recognition standard for the same class of action.

## 3. Tool-Agnostic state and validation capability model

Use these capability rules in all implementation planning and handoffs:

- `capability_owners`: a stack-defined map of ownership boundaries for behavior in scope
- `capability_owners` keys should be explicit in every implementation slice
- frontend state tiering policy is defined in `agent-docs/standards/architecture/frontend-state-ownership-standards.md`
- `test_layer_matrix`: explicitly classify `unit`, `component`, `integration`, and `e2e` as `required` or `N/A` with rationale

Do not:

- encode policy decisions in terms of specific libraries at the core layer
- treat implementation-ready slices as complete without explicit `capability_owners` and test evidence

## 4. Intake/Delivery model

**Vocabulary.** A **delivery slice** is one feature request, bug report, refactor, or roadmap item;
one primary context (the Delivery Engineer) owns it from intake to closeout. A **TDD increment** is
a small, independently reviewable unit inside a slice — one RED → GREEN → REFACTOR cycle for one
**behaviour** (the user-observable change). An increment is never a nested workflow: intake,
planning, and closeout run once per slice, not per increment.

**One primary context owns a slice end-to-end.** The workflow owner is not prohibited from doing
the work — it inspects, plans, defines BDD scenarios, writes the failing tests, implements,
refactors, verifies, and applies the review lenses in that one context. TDD phases (RED / GREEN /
REFACTOR) are **states**, not separate agents. Expertise (planning, test strategy, the review
lenses, contract modelling) is applied inline as procedure; it does not require a separate agent.

Default flow:

1. Normalize intake; classify complexity and sequence the delivery into TDD increments.
2. Per increment: RED (write the failing test for the intended behaviour) → GREEN (make it pass plus
   the regression surface) → REFACTOR (no behaviour change) → targeted verify.
3. Feature-level verification (broader integration / E2E) at the checkpoint.
4. Generate the conservative review-lens manifest, load only its selected references, and apply
   `skills/review-change/` (correctness always; uncertainty includes; model additions only);
   delegate to `independent-reviewer` only when the Delegation Gate is met.
5. Commit + push via the `commit-and-push` skill.
6. `delivery-engineer` re-enters only for blockers, approvals, or closeout.

Delegate to a **separate agent context** only when the Delegation Gate in
`agent-docs/routing/reasoning-selection-policy.md` is met (genuine independence, material
second-opinion value, context pollution, or an unresolved specialised decision). Difficulty, file
count, and module count are never reasons.

Do not:
- run multiple active workflow owners in parallel
- change production behaviour before the required RED evidence exists
- delegate a step just because it is non-trivial, spans several files/modules, or needs tests
- record anything that restates a stable referenced source (delta-only invariant)

## 5. Routing guidance across core specialists

Use:

- `skills/feature-planning/` (inline) for scope slicing, delivery sequencing, `test_layer_matrix` decisions, and pre-implementation failing-test design
- `skills/tdd-slice/` (inline) for test-first RED → GREEN → REFACTOR execution and the runtime/compatibility audit
- `skills/dependency-assessment/` (inline) for package/tooling/runtime dependency decisions — approve/reject/defer, escalating production-runtime / build-pipeline / broad-tooling / licensing changes to the user
- `skills/review-change/` (inline) for the diff-classified review lenses
- `architecture-advisor` for ownership, layering, and contract-sensitive decisions — consulted only when the Delegation Gate is met
- `skills/commit-and-push/` (inline) for post-review commit message authoring, commit execution, and push execution evidence
- `skills/create-develop-pr/` (inline; or the equivalent repo/stack-defined PR skill) for live PR creation, PR title/body authoring, and PR URL/number evidence — run only on an explicit, separate PR request, never automatically after commit-and-push
- stack/repo review specialists for post-implementation quality gates and closeout readiness

Return to `delivery-engineer` when handoff routing metadata indicates `blocked`, `awaiting-approval`, or `ready-for-closeout`.

## 6. Handoff and checkpoint expectations

Every record obeys the **delta-only invariant** (`agent-docs/templates/handoff-template.md`): for a
new workflow, link the canonical `slice-spec.json` by path/revision/hash; record only deltas,
evidence, and next state. Legacy workflows may link their existing request/plan. A record that
reproduces canonical fields is wrong even when every fact in it is correct.

- **Same-context step** → a compact **Step Record**: status, cached Execution Profile ID, TDD state + last
  command/result, changed areas, new decisions, blockers, next action.
- **Cross-context dispatch** (`delegation: advisor` / `independent` / `parallel`, or a fresh resume
  window) → a **Cross-Context Handoff Package**: line 1 `Use agent spec: <alias>`, the full
  Execution Profile Metadata block per `agent-docs/routing/execution-profile-schema.md`, a `Pass`
  section of source-of-truth pointers and current test-evidence values, `Expect`, and a
  `Return Contract` (`Return To Agent` default `delivery-engineer.agent.md`).

A completion / bootstrap block (target alias, artifact path, `Execution Profile` / `Reasoning
Demand` / `Delegation`, continue-workflow line) is emitted **only** for a cross-context dispatch or
a workflow-owner reentry (`blocked`, `awaiting-approval`, `ready-for-closeout`). In-context steps
just continue.

During Slice 1 shadow mode, every Markdown record above also produces one hash-chained event using
`agent-docs/workflows/workflow-ledger.md`. The event preserves commands and integer exit results,
SHAs, changed areas, decisions, risks, blockers, approvals, and free-form exceptions;
`ledger-views/` is always derived
and may be rebuilt. A ledger `dispatch-created` event is self-validating by event ID + hash and its
simulation path requires no acknowledgement round-trip. Existing Markdown artifacts remain beside
it until equivalence is proven and an explicit cutover is approved.

For a new Slice 2 workflow, every ledger event additionally retains the current canonical
slice-spec path, slice ID, revision, and content hash. Validate the spec at `planned`,
**implementation-ready**, and `closeout` gates with `scripts/slice-spec.mjs`; do not copy its fields
into ledger summaries or handoffs.

Every artifact has a ceiling (Artifact budgets table in
`agent-docs/templates/handoff-template.md`): initial plan 600–1,000 words; advisor result 500; TDD
checkpoint 100–250; independent review 600; blocker checkpoint 300; closeout 500; `index.md` < 150
lines. Exceeding a ceiling requires a one-line `Budget note:` in the artifact.

Create checkpoints (a compact Step Record) when:

- a meaningful slice completes
- approval is required
- a blocker prevents continuation
- work must pause and resume later

Use these shared docs:
- `agent-docs/workflows/handoff-workflow.md`
- `agent-docs/workflows/workflow-ledger.md`
- `agent-docs/workflows/canonical-slice-spec.md`
- `agent-docs/workflows/review-lens-manifest.md`
- `agent-docs/workflows/feature-workflow-routing.md`
- `agent-docs/workflows/bug-workflow-routing.md`
- `agent-docs/standards/architecture/frontend-state-ownership-standards.md`
- `agent-docs/templates/handoff-template.md`
- `agent-docs/templates/checkpoint-template.md`
- `agent-docs/schemas/workflow-ledger-event.schema.json`
- `agent-docs/schemas/slice-spec.schema.json`
- `agent-docs/schemas/review-lens-manifest.schema.json`
- `agent-docs/templates/feature-request-template.md`
- `agent-docs/templates/bug-report-template.md`
- `agent-docs/routing/execution-profile-schema.md`
- `agent-docs/routing/execution-profile-policy.md`
- `agent-docs/routing/reasoning-selection-policy.md`
- `agent-docs/routing/core-agent-execution-profile-defaults.md`
- `agent-docs/routing/execution-profile-worked-examples.md`

## 7. Approval boundaries

Pause and escalate when work requires:

- new dependencies or dependency upgrades with broad impact
- new top-level architecture or broad refactors
- new runtime or environment assumptions
- material scope expansion
- external contract changes affecting other consumers
- bypassing required pre-implementation failing tests

## 8. Test-First enforcement

Regression contract rule:

- existing tests are regression protections and must be preserved by default
- do not modify, weaken, or delete an existing test just to accommodate a new implementation
- when new behavior is added, prefer adding new tests before altering existing ones
- change an existing test only when the asserted behavior is intentionally changing, the test is demonstrably incorrect, or the test is overly implementation-coupled and must be rewritten to express the intended contract
- any change to an existing test should be explicit in the handoff/checkpoint, including why the prior test no longer represented the correct contract


Implementation work is not ready to start until all are true:

- `test_layer_matrix` exists for `unit`, `component`, `integration`, and `e2e`
- `capability_owners` exists with stack-required keys
- each layer is marked `required` or `N/A` with rationale
- `required_preimplementation_tests` are identified
- `preimplementation_failing_test_evidence` is recorded

Closeout is not ready until all are true:

- required `required_preimplementation_tests` are passing
- required `e2e_status` is `passing`
- required stack/repo review gates are passing with no blocking findings
- commit authoring evidence includes commit SHA(s) plus successful push command evidence (remote + branch/ref)
- compatibility impacts and breaking-change/migration handling are explicit in handoff/checkpoint artifacts when relevant
- any `N/A` decisions remain explicit and justified

PR creation is not a closeout precondition. The `create-develop-pr` skill runs only on an explicit, separate PR request and is reported independently of workflow closeout. If a PR was explicitly requested during the workflow, its evidence (live PR URL plus PR number) should also be recorded, but closeout itself never waits on it.

## 9. Layering and override model

`agents-core` provides stack-neutral workflow and governance baseline.

- stack-specific policy belongs in stack packs
- repo-specific facts and exceptions belong in repo-local overlays
- overlays may tighten or override defaults with explicit rationale
- overlays should define concrete package/tool mappings for stack-defined `capability_owners` and `test_layer_matrix`
- avoid duplicating stack rules in core unless they are clearly cross-stack
