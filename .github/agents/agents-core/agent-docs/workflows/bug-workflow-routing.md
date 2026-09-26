# bug-workflow-routing.md

## Purpose

This document defines the default end-to-end workflow for bug triage and fixes when using `agents-core`.

## Delivery model

- **Vocabulary** (canonical: `agents-core/AGENTS.md` §4). A **delivery slice** is this one bug fix.
  A **TDD increment** is a small RED → GREEN → REFACTOR cycle for one **behaviour** inside the
  slice — never a nested workflow; intake, planning, and closeout run once per slice.
- **One primary context owns the slice end-to-end.** The workflow owner reproduces, writes the
  failing regression test, fixes, refactors, verifies, and applies the review lenses — all inline.
  Reproduction / test strategy / fix / verification are **states**, not separate agents.
- Delegate to a separate agent context only when the Delegation Gate in
  `agent-docs/routing/reasoning-selection-policy.md` is met.
- The workflow owner re-enters its role explicitly only for `blocked`, `awaiting-approval`, or
  `ready-for-closeout`.

## Artifact persistence

- Create and progressively populate `.agent-workflows/<workflow_id>/slice-spec.json` as the single
  source for objective, acceptance criteria, scope, provenance, approvals, capability owners,
  test matrix, increments, expected RED evidence, and verification.
- Persist a compact **Step Record** per step under `.agent-workflows/<workflow_id>/` (delta-only —
  link the canonical slice spec by revision/hash, do not restate it), keep `.agent-workflows/<workflow_id>/index.md` current,
  and delete `.agent-workflows/<workflow_id>/` when closeout is complete.
- Emit a Fresh Context Bootstrap line / completion block only for a cross-context dispatch or a
  reentry state.

## Bug intake and classification

- Bug intake requires a leading `Bug Fix` trigger; if missing, request a correctly triggered
  reissue before starting.
- Validate trigger format and normalize the report using
  `.github/agents/agents-core/agent-docs/templates/bug-report-template.md`.
- Persist the normalized intake directly as `slice-spec.json`; inline planning enriches that same
  record and validates its `planned` gate instead of creating a duplicate narrative plan.
- Triggered intake is fail-closed until workflow bootstrap artifacts exist and the required RED
  (failing regression test) evidence exists.
- Classify complexity (`trivial` or `non-trivial`) with rationale.

### Mandatory work-branch preflight

Before creating a workflow artifact or editing a test or production file, complete all of the
following. Any failure is `blocked`; report the exact Git failure and make no implementation edit.

1. Require a clean working tree; otherwise stop and report the uncommitted files.
2. Fetch `origin/develop`; stop if `origin` or `origin/develop` is unavailable.
3. Switch to local `develop`, creating a tracking branch from `origin/develop` if it is absent.
4. Run `git pull --ff-only origin develop`. Stop on a failure or divergence; never merge, rebase,
   reset, or discard local work to force synchronization.
5. Derive a concise Git-safe lowercase kebab-case slug from the normalized bug summary. Stop if no
   usable slug can be derived.
6. Check that `bugfix/<slug>` exists neither locally nor on `origin`. A collision stops intake;
   never reuse the branch or generate an automatic suffix.
7. Create `bugfix/<slug>` from synchronized local `develop`. Record the branch, `develop` base
   SHA, and preflight command evidence in the first Step Record. Do not push an empty branch.

### Trivial fast-path eligibility

The fast path skips **planning ceremony only** — never the failing regression test or the review
lenses. It is allowed only when all are true:

- behavior and acceptance criteria are explicit
- repro scope is localized to a small area
- no approval-boundary work is expected
- no cross-feature boundary or contract changes are expected

If any condition fails, do the full planning pass inline.

## Delivery path

1. Intake + normalization + mandatory work-branch preflight + complexity classification (inline).
2. Reproduce the defect. **RED**: write the failing test that captures the correct behaviour, and
   confirm it fails for the expected reason.
3. **GREEN**: apply the fix; the new test plus the regression surface pass. **REFACTOR** with no
   behaviour change.
4. Verify: required `e2e_status` must be `passing` before closeout. If a full-suite failure is
   outside the changed behaviour, classify it against the merge-base and record it — do not repair
   unrelated baseline failures in this fix.
5. Generate the conservative `review-lens-manifest.json` from the completed diff and canonical
   slice spec, load only its `loadReferences`, then apply every included lens (correctness always).
   A blocking finding routes scoped rework inline; regenerate the manifest and rerun affected lenses.
6. Commit + push via the `commit-and-push` skill.
7. Re-enter the workflow-owner role for blocker / approval / closeout events.
8. PR authoring runs only on a separate, explicit PR request; never automatic, never a closeout
   precondition.

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
- A review lens applied by the agent that produced the fix is `delegation: inline`; raise `delegation` only when the Delegation Gate is met.
- The closeout step record links the manifest path/hash, lists which lenses ran, and retains each skipped lens's machine reason code.
- The always-on correctness lens plus every manifest-included lens must be complete with no blocking findings before closeout.
- Commit authoring must run only after the applicable reviewer gates pass with no blocking findings.
- Commit-and-push success (commit SHA(s) plus push evidence) is sufficient for `ready-for-closeout`; PR authoring is never required for closeout.
- PR authoring must run only on an explicit, separate PR request, and only after commit authoring is complete and commit SHAs are recorded; it must never be dispatched automatically after commit-and-push.

## Pre-existing baseline failures

If a full-suite run fails on a test **outside the behaviour this fix changed**:

1. Reproduce it once against the merge-base — `node scripts/classify-baseline-failure.mjs --test "<the failing test command>"` (or check out `git merge-base HEAD <default-branch>` and run it by hand).
2. If the base ref also fails → classify **pre-existing**. Record it in the closeout step record (base ref, command, result), confirm this fix's own tests pass, and continue.
3. If the base ref passes → this fix **introduced** it; fix it before closeout.
4. **Do not repair unrelated pre-existing baseline failures inside this fix** — capture them as separate follow-up.

## Checkpoint and resume behavior

- Create a checkpoint when a slice completes, approval is needed, a blocker is hit, or context continuity risk increases.
- Resume by loading the latest checkpoint and the source-of-truth report/plan it links, then continuing from the pending step (in the primary context unless the Delegation Gate is met).
