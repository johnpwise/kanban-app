# feature-workflow-routing.md

## Purpose

This document defines the default end-to-end workflow for feature delivery when using `agents-core`.

## Delivery model

- **Vocabulary** (canonical: `agents-core/AGENTS.md` §4). A **delivery slice** is this one feature
  request. A **TDD increment** is a small RED → GREEN → REFACTOR cycle for one **behaviour** inside
  the slice — never a nested workflow; intake, planning, and closeout run once per slice.
- **One primary context owns the slice end-to-end.** The workflow owner plans, defines BDD
  scenarios, writes the failing tests, implements, refactors, verifies, and applies the review
  lenses — all inline. Plan / test strategy / implementation / verification are **states**, not
  separate agents.
- Delegate to a separate agent context only when the Delegation Gate in
  `agent-docs/routing/reasoning-selection-policy.md` is met.
- The workflow owner re-enters its role explicitly only for `blocked`, `awaiting-approval`, or
  `ready-for-closeout`.

## Artifact persistence

- Create and progressively populate `.agent-workflows/<workflow_id>/slice-spec.json` as the single
  source for objective, acceptance criteria, scope, provenance, approvals, capability owners,
  test matrix, increments, expected RED evidence, and verification.
- Persist a compact **Step Record** per step under `.agent-workflows/<workflow_id>/` (delta-only —
  link the canonical slice spec by revision/hash, do not restate it), and keep
  `.agent-workflows/<workflow_id>/index.md` current.
- Emit a Fresh Context Bootstrap line and a completion block only for a cross-context dispatch or a
  reentry state; resolve its path from `Latest Prompt by Target Agent` in the index.
- Delete `.agent-workflows/<workflow_id>/` when closeout is complete.

## Feature intake and classification

- Feature intake requires a leading `New Feature` trigger; if missing, request a correctly
  triggered reissue before starting.
- Validate trigger format and normalize the request using
  `.github/agents/agents-core/agent-docs/templates/feature-request-template.md`.
- Persist the normalized intake directly as `slice-spec.json`; inline planning enriches that same
  record and validates its `planned` gate instead of creating a duplicate narrative plan.
- Triggered intake is fail-closed until workflow bootstrap artifacts exist and, for any production
  behaviour change, the required RED evidence exists.
- Classify complexity (`trivial` or `non-trivial`) with rationale, then sequence the delivery into
  TDD increments.

### Mandatory work-branch preflight

Before creating a workflow artifact or editing a test or production file, complete all of the
following. Any failure is `blocked`; report the exact Git failure and make no implementation edit.

1. Require a clean working tree; otherwise stop and report the uncommitted files.
2. Fetch `origin/develop`; stop if `origin` or `origin/develop` is unavailable.
3. Switch to local `develop`, creating a tracking branch from `origin/develop` if it is absent.
4. Run `git pull --ff-only origin develop`. Stop on a failure or divergence; never merge, rebase,
   reset, or discard local work to force synchronization.
5. Derive a concise Git-safe lowercase kebab-case slug from the normalized feature summary. Stop
   if no usable slug can be derived.
6. Check that `feature/<slug>` exists neither locally nor on `origin`. A collision stops intake;
   never reuse the branch or generate an automatic suffix.
7. Create `feature/<slug>` from synchronized local `develop`. Record the branch, `develop` base
   SHA, and preflight command evidence in the first Step Record. Do not push an empty branch.

### Trivial fast-path eligibility

The fast path skips **planning ceremony only** — never test-first evidence or the review lenses. It
is allowed only when all are true:

- behavior and acceptance criteria are explicit
- scope is localized to a small area
- no approval-boundary work is expected
- no cross-feature boundary or contract changes are expected

If any condition fails, do the full planning pass inline.

## Delivery path

1. Intake + normalization + mandatory work-branch preflight + complexity classification (inline).
2. Sequence into TDD increments. For each increment: **RED** (write the failing test for the
   intended behaviour) → **GREEN** (make it pass plus the regression surface) → **REFACTOR** (no
   behaviour change) → targeted verify.
3. Feature-level verification (broader integration / E2E) at the checkpoint; required `e2e_status`
   must be `passing` before closeout.
4. Generate the conservative `review-lens-manifest.json` from the completed diff and canonical
   slice spec, load only its `loadReferences`, then apply every included lens (correctness always).
   A blocking finding routes scoped rework inline; regenerate the manifest and rerun affected lenses.
5. Commit + push via the `commit-and-push` skill; commit SHA(s) + push evidence make the workflow
   `ready-for-closeout`.
6. Re-enter the workflow-owner role for blocker / approval / closeout events; close only when all
   applicable gates pass.
7. PR authoring runs only on a separate, explicit PR request; never automatic, never a closeout
   precondition.

## Procedures and conditional specialists

Applied **inline** unless the Delegation Gate is met:

- **architecture** — when ownership, layering, public contracts, or module boundaries are changing
  or unclear. Consider `delegation: advisor` for an independent structural opinion, or
  `delegation: parallel` when two or more viable approaches genuinely need independent evaluation.
- **contract modelling** — when request/response/error shapes, nullability, or mapping boundaries
  are unclear or changing.
- **dependency assessment** — for new dependencies or material dependency/tooling/runtime changes;
  escalate genuinely unusual decisions to the user.
- **commit + push** — via the `commit-and-push` skill, after the applicable review lenses pass with
  no blockers.

The `create-develop-pr` skill (or the repo/stack-defined PR skill) runs only on an explicit,
separate PR request; never automatic, never a closeout precondition.

## Mandatory evidence and review gates

- Implementation must not start before required `test_layer_matrix` exists (`unit`, `component`, `integration`, `e2e`) with `required` or `N/A` rationale.
- Implementation must not start before required `required_preimplementation_tests` are identified.
- Implementation must not start before required `preimplementation_failing_test_evidence` is recorded.
- Planner classification (`trivial` or `non-trivial`) must be explicit before execution routing.
- Fast-path must not bypass test-first/evidence/review gates.
- `capability_owners` with stack-defined required keys must be explicit for implementation slices.
- for frontend slices that set `capability_owners.shared_client_state_owner`, `capability_owners.shared_client_state_tier` (`subtree` | `cross_feature`) must also be explicit.
- Required `e2e_status` must be `passing` before closeout.
- Review is **diff-classified** through the deterministic conservative manifest: exactly one lens is always-on — **correctness** — and conditional lenses are included from the diff and slice spec. Uncertainty includes the lens; model judgment may add but never remove one; skips retain machine reason codes. Each stack pack owns the available lens inventory.
- A review lens applied by the agent that produced the diff is `delegation: inline`; raise `delegation` only when the Delegation Gate is met (for example an isolated review of an authorization or data-boundary change).
- The closeout step record links the manifest path/hash, lists which lenses ran, and retains each skipped lens's machine reason code.
- The always-on correctness lens plus every manifest-included lens must be complete with no blocking findings before closeout.
- Commit authoring must run only after the applicable reviewer gates pass with no blocking findings.
- Commit-and-push success (commit SHA(s) plus push evidence) is sufficient for `ready-for-closeout`; PR authoring is never required for closeout.
- PR authoring must run only on an explicit, separate PR request, and only after commit authoring is complete and commit SHAs are recorded; it must never be dispatched automatically after commit-and-push.

## Pre-existing baseline failures

If a full-suite run fails on a test **outside the behaviour this slice changed**:

1. Reproduce it once against the merge-base — `node scripts/classify-baseline-failure.mjs --test "<the failing test command>"` (or check out `git merge-base HEAD <default-branch>` and run it by hand).
2. If the base ref also fails → classify **pre-existing**. Record it in the closeout step record (base ref, command, result), confirm this slice's own tests pass, and continue to closeout.
3. If the base ref passes → this slice **introduced** it; fix it before closeout.
4. **Do not repair unrelated pre-existing baseline failures inside this slice** — capture them as separate follow-up, don't expand scope.

## Checkpoint and resume behavior

- Create a checkpoint when a slice completes, approval is needed, a blocker is hit, or context continuity risk increases.
- Resume by loading the latest checkpoint and canonical slice spec it links (or the existing plan
  for a legacy workflow), then continue from the pending step in the primary context unless the
  Delegation Gate is met.
