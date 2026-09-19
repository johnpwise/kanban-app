# Execution Profile Routing: End-to-End Validation Report

## Purpose

Records the Slice 8 end-to-end validation pass over the completed execution-profile routing architecture (Slices 1-7): deterministic validator results, a live bootstrap-copy dry run, live Claude Code native-mapping evidence, four cross-stack workflow dry-run traces, a regression spot-check, and a release-readiness recommendation.

## A. Deterministic validator results

Run from repository root on 2026-07-18:

```
$ node scripts/validate-execution-profiles.mjs
Execution-profile validation passed.

$ node scripts/validate-alias-routing.mjs
Alias routing validation passed.

$ node scripts/validate-skills.mjs
Skill validation passed. (9 manifest skills checked)

$ node --test 'scripts/**/*.test.mjs' 'bootstrappers/**/*.test.mjs'
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

All three repository validators pass. All 16 tests pass (9 execution-profile tests, 7 pre-existing component-layout tests) — none touched by this update regressed.

Incidental confirmation the model-leakage guardrail works: an early draft of this very report named a concrete Claude model identifier by name in Section C's prose. `validate-execution-profiles.mjs` flagged the violation immediately with the offending file and matched text; the report was reworded to reference the model class label instead of the identifier, and the validator now passes clean. Noted here (without repeating the flagged text, to avoid re-tripping the same check) as evidence rather than scrubbed from the history of this validation pass.

## B. Live bootstrap-copy dry run (defect found and fixed during this validation)

**Method:** executed the exact copy operations documented in the "Copy Platform Execution-Profile Mappings" bootstrapper step against a scratch directory, twice in a row, to test the idempotency claim made in Slice 5.

**Finding:** the originally documented instruction (`cp -R platforms .github/agents/platforms`) is **not** idempotent. Standard `cp -R` semantics copy the source directory *inside* the destination when the destination already exists, producing a nested `.github/agents/platforms/platforms/...` on any re-run — contradicting the "re-running the bootstrapper... must overwrite only these two files" claim written in Slice 5. Reproduced with a minimal `cp -R` test unrelated to this repo's content, confirming it's general shell behavior, not a fluke.

**Fix applied (in this slice):** changed the copy instruction in all four bootstrappers (`bootstrappers/react/`, `bootstrappers/vue/`, `bootstrappers/node-express/`, `bootstrappers/node-express-ts/`) and in root `README.md`'s Path B manual-install instructions to copy each mapping file individually (`claude-code/execution-profile-mapping.md`, `codex/execution-profile-mapping.md`) rather than the containing directory as one unit, with an explicit note explaining why the directory-level form is unsafe to re-run.

**Re-verification after the fix:**

```
First run:  .github/agents/platforms/claude-code/execution-profile-mapping.md
            .github/agents/platforms/codex/execution-profile-mapping.md
Second run: .github/agents/platforms/claude-code/execution-profile-mapping.md
            .github/agents/platforms/codex/execution-profile-mapping.md
File count after two runs: 2 (expected 2, no nesting)
Both files non-empty: PASS
```

The fix is confirmed idempotent. All validators and the full test suite were re-run after the fix and still pass (Section A results are post-fix).

**Note on scope:** the pre-existing common-skills copy step (`skills/manifest.json` → `.agents/skills/<name>/`, `.claude/skills/<name>/`) uses looser prose ("copy the complete skill directory") that could theoretically invite the same class of mistake, but that step predates this update and is explicitly *not* the documented re-sync path — `scripts/sync-skills.mjs` is. Fixing that pre-existing step is out of scope for this update ("fix only defects directly attributable to this update"); it is recorded as a residual observation in Section H.

## C. Claude Code native mapping — live validation

Dispatched a real subagent via the `Agent` tool using `model: haiku`, the exact native mechanism the Claude Code mapping doc assigns to its `Low` effort tier (`platforms/claude-code/execution-profile-mapping.md`, Model Classes table: the "Fastest" class, mapped there to a concrete model identifier). Task: read the mapping doc itself and report its title and the `lightweight` row of its mapping table.

**Result:** the dispatch succeeded and returned accurate content:

```
Title: # Claude Code Execution Profile Mapping
lightweight row: | `lightweight` | `Low` | Fastest | Single agent. |
```

This confirms the documented mechanism (`Agent` tool `model` parameter selecting a concrete model class per the mapping table) is real and executable in this host, not only descriptive.

## D. Codex native mapping — validation limitation

No Codex execution environment is available in this session. Codex-side validation in this slice is limited to what Slice 6's deterministic validator already checks structurally: every shared `reasoning_demand` level has a row in `platforms/codex/execution-profile-mapping.md`'s Execution Profile Mapping Table, and no concrete Codex model identifier leaks outside `platforms/`. **Live validation of the Codex native agent-role/reasoning-effort configuration mechanism was not performed and is recorded as a residual risk in Section H.**

## E. Cross-stack workflow dry-run traces

Four traces, one per supported stack, each cross-checked against the actual current content of that stack's `model-routing-policy.md` and `agents-core/agent-docs/routing/core-agent-execution-profile-defaults.md` (not re-used from the Slice 7 worked examples, to independently confirm the real files resolve correctly).

### Trace 1 — React, New Feature, upstream escalation absorbed before implementation

*"Add inline validation error styling to the signup form's email field, sourced from a shared validation schema also used by the API contract."*

| # | Agent | Profile | Demand | Note |
| --- | --- | --- | --- | --- |
| 1 | `workflow-orchestrator` | `planning-routine` | `routine` | Default per core-agent defaults. |
| 2 | `feature-plan-delivery-orchestrator` | `planning-complex` | `complex` | Escalated from `planning-routine`: shared schema decision affects the API contract, not just the form. |
| 3 | `api-contract-modeling.agent.md` | `architecture-complex` | `complex` | Stack default for this agent (react `model-routing-policy.md`); absorbs the contract-shape risk before implementation. |
| 4 | `test-strategy-engineer` | `testing-routine` | `routine` | Bounded once the contract is settled. |
| 5 | `implementation-engineer` | `implementation-routine` | `routine` | Not escalated — upstream contract-modeling step already resolved the ambiguity. |
| 6 | `frontend-code-reviewer` | `review-routine` | `routine` | Small diff, no interacting findings. |
| 7 | `accessibility-ux-reviewer` | `review-routine` | `routine` | Simple inline error text, no modal/focus complexity. |
| 8 | `commit-authoring-operator` | `delivery-lightweight` | `lightweight` | Clean push. |

**Confirms:** escalation resolved by the specialist designed for it (`api-contract-modeling`) does not force every downstream dispatch to inherit a higher profile.

### Trace 2 — Vue, Bug Fix, reviewer rework loop

*"Theme picker doesn't persist selection after reload."*

| # | Agent | Profile | Demand | Note |
| --- | --- | --- | --- | --- |
| 1 | `workflow-orchestrator` | `planning-routine` | `routine` | |
| 2 | `feature-plan-delivery-orchestrator` | `planning-routine` | `routine` | Trivial classification. |
| 3 | `test-strategy-engineer` | `testing-routine` | `routine` | |
| 4 | `implementation-engineer` (first pass) | `implementation-lightweight` | `lightweight` | Expected one-line `localStorage` write. |
| 5 | `frontend-code-reviewer` | `review-complex` | `complex` | Escalated from `review-routine`: fix writes to storage but `appStore.ts` init never reads it back — persistence still broken. Returns `changes-required` (blocking). |
| 6 | `workflow-orchestrator` (re-entry) | `planning-routine` | `routine` | Routes scoped rework. |
| 7 | `implementation-engineer` (rework) | `implementation-routine` | `routine` | Assigned directly by the orchestrator; corrective scope (init-time read) is larger than the original one-liner. |
| 8 | `frontend-code-reviewer` (re-run) | `review-routine` | `routine` | Passes. |
| 9 | `vue-state-ownership-guardian` (re-run) | `review-routine` | `routine` | Store read/init path changed; re-run required, narrow/obvious ownership, passes. |
| 10 | `commit-authoring-operator` | `delivery-lightweight` | `lightweight` | |

**Confirms:** a blocking finding is never silently waved through; both required gates re-run and both must pass before delivery.

### Trace 3 — Node/Express, New Feature, high-risk escalation cascade

*"Add an endpoint that transfers loyalty points between two customer accounts atomically."*

| # | Agent | Profile | Demand | Note |
| --- | --- | --- | --- | --- |
| 1 | `workflow-orchestrator` | `planning-routine` | `routine` | |
| 2 | `feature-plan-delivery-orchestrator` | `planning-complex` | `complex` | Escalated: multi-record atomic transfer, transaction-boundary ownership unclear. |
| 3 | `architecture-planner` | `architecture-intensive` | `intensive` | Escalated from `architecture-complex`: `risk: high` floors at `intensive` per the Selection Procedure; new transactional boundary spanning two account records. |
| 4 | `api-contract-modeling.agent.md` | `architecture-complex` | `complex` | Stack default; new endpoint, request/response shape to assess. |
| 5 | `test-strategy-engineer` | `testing-complex` | `complex` | Escalated: concurrent-transfer race-condition coverage required. |
| 6 | `implementation-engineer` | `implementation-intensive` | `intensive` | Escalated from `implementation-routine` per the backend "Transactional or multi-record write changes" escalation criterion. |
| 7 | `persistence-and-transaction-reviewer` | `review-complex` | `complex` | Stack default for this agent — transactional correctness review is never treated as routine, no escalation needed. |
| 8 | `route-handler-boundary-guardian` | `review-routine` | `routine` | Boundaries stayed clean; no escalation. |
| 9 | `backend-code-reviewer` | `review-complex` | `complex` | Escalated from `review-routine`: diff spans route, service, repository, and transaction layers. |
| 10 | `commit-authoring-operator` | `delivery-lightweight` | `lightweight` | Commit mechanics unaffected by the upstream escalation. |

**Confirms both remaining numeric acceptance criteria at once:** profile changes across planning (`routine`→`complex`), architecture/implementation (`intensive`), review (`complex` default plus `routine`→`complex`), and delivery (`lightweight`) within a single workflow; and high-risk transactional work correctly receives a stronger profile at exactly the dispatches whose own risk signal justifies it.

### Trace 4 — Node/Express TypeScript, Bug Fix, routine baseline (no orchestration)

*"`GET /products/:id` returns 500 instead of 404 for an unknown id."*

| # | Agent | Profile | Demand |
| --- | --- | --- | --- |
| 1 | `workflow-orchestrator` | `planning-routine` | `routine` |
| 2 | `feature-plan-delivery-orchestrator` | `planning-routine` | `routine` |
| 3 | `test-strategy-engineer` | `testing-routine` | `routine` |
| 4 | `implementation-engineer` | `implementation-lightweight` | `lightweight` |
| 5 | `route-handler-boundary-guardian` | `review-routine` | `routine` |
| 6 | `backend-code-reviewer` | `review-routine` | `routine` |
| 7 | `commit-authoring-operator` | `delivery-lightweight` | `lightweight` |

**Confirms:** `orchestrated` mode is correctly *not* invoked for a single, deterministic status-code fix — there is no genuinely independent, concurrently-verifiable workstream here, so the Orchestration Justification Test in `reasoning-selection-policy.md` would fail all three of its conditions if applied. The catalogue's `orchestration-*` profiles remain available (and pass Slice 6's structural validation) for scenarios that do warrant decomposition, such as a severe production incident with multiple candidate root causes — none of the four traces needed one, which is itself the correct outcome for these scenarios.

## F. Regression spot-check

Confirmed unregressed after all seven prior slices (grep counts against `agents-core/agents/workflow-orchestrator.agent.md`, `agents-core/AGENTS.md`, `agents-core/agent-docs/workflows/handoff-workflow.md`):

- Test-first / evidence gate language (`preimplementation_failing_test_evidence`): present, non-zero in all three files.
- Review rework language (`scoped rework`): present in both orchestrator and handoff-workflow docs.
- Commit/push gate (`commit-authoring-operator`): present in both orchestrator and core `AGENTS.md`.
- Closeout gate (`ready-for-closeout`): present in orchestrator (4 occurrences); `handoff-workflow.md` expresses closeout via its own "Closeout" and "Artifact Cleanup On Closeout" sections rather than that literal token, which is pre-existing and unrelated to this update.
- PR-never-automatic guardrail: both required sentences intact in core `AGENTS.md`, and independently enforced by `scripts/validate-skills.mjs`'s forbidden-pattern checks (still passing per Section A).

No regression found in test-first, review, skills, commit/push, or closeout behavior.

## G. Acceptance criteria checklist

| Criterion | Status | Evidence |
| --- | --- | --- |
| At least one workflow changes profile between planning, implementation, review and delivery | Met | Trace 3 (Section E) |
| High-risk work receives an appropriately stronger profile | Met | Trace 3 (Section E) |
| Orchestrated mode used only where specialist decomposition is justified | Met | Trace 4 + catalogue note (Section E); `orchestrated` never appears in any of the four traces, correctly |
| All repository validators pass | Met | Section A |
| No regression in test-first, review, skills, commit/push, or closeout behavior | Met | Section F |

## H. Residual risks and limitations

1. **Codex native validation not performed.** No Codex execution environment was available in this session. Only structural/document validation (Slice 6's automated validator) covers the Codex mapping. Recommend a follow-up validation pass from a Codex-capable environment before treating Codex-side operator guidance as field-proven.
2. **Pre-existing skills-copy step wording.** The common-skills bootstrapper step ("copy the complete skill directory") is loosely worded in a way that could invite the same class of `cp -R` re-run mistake found and fixed in Section B, but it predates this update and its documented re-sync path is the dedicated `scripts/sync-skills.mjs`, not literal bootstrapper re-invocation. Left unchanged, out of scope for this update.
3. **No live full-stack scaffold run.** This validation did not run a real `npm create vite@8` / Vite / Cypress scaffold for any of the four stacks end-to-end (that machinery predates this update and is unrelated to execution-profile routing); validation instead targeted the specific new/changed surface (platform-mapping copy, dispatch metadata contract, routing docs) plus a structural dry run of the full dispatch sequence. A full scaffold run remains a reasonable periodic maintenance check but is not required to certify this update.
4. **Worked examples vs. dry-run traces are illustrative, not executable.** Both Slice 7's worked examples and this report's Section E traces are constructed narratives cross-checked against real file content, not transcripts of an actual `.agent-workflows/` run (this repository has no live project to run a workflow against). They are evidence of contract *consistency*, not of live multi-turn agent behavior.

## I. Release-readiness recommendation

**Recommendation: ready to release**, with the two residual items in Section H (1) and (3) tracked as non-blocking follow-ups.

Rationale: every Slice 8 acceptance criterion is met with direct evidence (Section G); the one real defect this validation pass surfaced (Section B, the `cp -R` re-run nesting bug) was found, fixed, and re-verified within this same slice; all three deterministic validators and the full test suite pass; live evidence confirms the Claude Code native mapping mechanism is real and correctly wired; and no regression was found in any pre-existing gate behavior.
