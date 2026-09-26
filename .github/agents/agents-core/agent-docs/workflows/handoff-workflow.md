# Agent Handoff Workflow

## Purpose

This document defines how a delivery slice is recorded and how the rare cross-context dispatch
works. The default is one primary context — the `delivery-engineer` — owning the slice end-to-end;
a separate agent context is used only when the Delegation Gate is met.

## Core Rules

1. One delivery slice has one active owner: `delivery-engineer`.
2. `delivery-engineer` records each step; only a step handed to a separate agent context is dispatched as a **Cross-Context Handoff Package**.
3. Records follow `agent-docs/templates/handoff-template.md` and its **delta-only invariant**: for
   a new workflow, link the canonical `slice-spec.json` by path/revision/hash and record only
   deltas, evidence, and next state; never restate its fields. Legacy workflows may link their
   existing request/plan.
4. Same-context steps use the compact **Step Record**. Only a dispatch to a **separate agent context** (`delegation: advisor` / `independent` / `parallel`, or a fresh resume window) uses the full **Cross-Context Handoff Package**, and only that shape begins with line 1 `Use agent spec: <Agent-Spec-Alias>` (alias from `agent-docs/routing/agent-spec-alias-map.md`, never a path form).
5. The guard acknowledgement ritual (`Active Agent` + `Execution Profile` + `Reasoning Demand` + `Delegation` echoed back before work) applies **only to a separate agent context**. In-context steps do not acknowledge to themselves.
6. For a Cross-Context Handoff Package, the receiving context must acknowledge before starting; the dispatcher reissues on a missing or mismatched acknowledgement.
7. Prefer the smallest competent next step, and keep it in the primary context unless the Delegation Gate is met.
8. Preserve explicit approvals, assumptions, and deferrals across steps.
9. Keep work incremental and reversible.
10. Enforce test-first sequencing for implementation slices.
11. Record current test-evidence values (status, last command + result) in each implementation step record and checkpoint — the `test_layer_matrix` itself is read from the source of truth, not restated.
12. Keep stack-specific or repo-specific command triggers in overlays; core does not prescribe command text.
13. Persist prompts, step records, checkpoints, and cross-context handoffs as Markdown artifacts on disk.
14. Maintain one Workflow Artifact Index per workflow at `.agent-workflows/<workflow_id>/index.md`, using single repo-relative paths (no dual absolute+relative columns).
15. Use a file-based fresh-context bootstrap line (absolute prompt artifact path) only when a step is actually picked up in a separate context.
16. When workflow status becomes `closed`, delete `.agent-workflows/<workflow_id>/` after final closeout is emitted.
17. A completion / bootstrap block (target alias, prompt/handoff path, continue-workflow line) is required only for a cross-context dispatch or resume; in-context steps just continue.
18. Every prompt and every Cross-Context Handoff Package carries the full Execution Profile Metadata block (`execution_profile`, `capability`, `reasoning_demand`, `delegation`, `risk`, `scope`, `reversibility`, `verification`, `rationale`) per `agent-docs/routing/execution-profile-schema.md`. A Step Record carries the one-line form (profile | `reasoning_demand` | `delegation` | rationale).
19. Execution profile assignment is per-dispatch: successive dispatches within one workflow may use different profiles, and a specialist may escalate its own `reasoning_demand` or propose raising `delegation` but must never silently downgrade a `reasoning_demand` or `delegation` assigned by the dispatching orchestrator or a prior escalation.
20. `reasoning_demand` (`lightweight`, `routine`, `elevated`, `deep`) and `delegation` (`inline`, `advisor`, `independent`, `parallel`) are independent decisions. Per the Realization Rule in `agent-docs/routing/reasoning-selection-policy.md`: `reasoning_demand` is advisory model/effort at every level and never by itself forces a separate context; `delegation: inline` (the default) runs in the primary context, and `advisor`/`independent`/`parallel` are dispatched through the `Agent` tool with each subagent's model set from its own `reasoning_demand`. Difficulty alone never raises `delegation` — see the Delegation Gate.
21. During Slice 1 shadow mode, append one equivalent event to `ledger.jsonl` after each existing Markdown artifact and derive `ledger-views/`; never edit ledger history or treat a derived view as independent state.

## Workflow Event Ledger v1 (Shadow Mode)

Follow `workflow-ledger.md` and its JSON schema. The current Markdown layout below remains in place
beside the ledger while equivalence is measured. Each event preserves commands with exit results,
SHAs, changed areas, decisions, risks, blockers, approvals, and free-form exceptions. The ledger is
hash-chained; the views are disposable and recoverable.

A ledger cross-context simulation appends one complete `dispatch-created` event. That append is the
atomic dispatch commit: the receiver validates its event ID and hash and starts without an
acknowledgement round-trip. Append `handoff-returned` to resolve it. This simulation does not relax
the Delegation Gate, execution-profile floor, alias validation, or return contract, and does not
remove the compatibility artifact during shadow mode.

## Workflow Artifact Index v1 (Required)

Use this runtime storage layout for every workflow:

- `.agent-workflows/<workflow_id>/index.md`
- `.agent-workflows/<workflow_id>/prompts/*.prompt.md`
- `.agent-workflows/<workflow_id>/handoffs/*.handoff.md`
- `.agent-workflows/<workflow_id>/checkpoints/*.checkpoint.md`

Notes:
- `.agent-workflows/` is runtime workflow state and should not be manually edited.
- Use Markdown as the source of truth; no JSON manifest is required.

### Artifact Naming Contract

Every persisted prompt, handoff, and checkpoint receives one workflow-wide Artifact ID.

- Artifact IDs use the format `artifact-NNN`, with a zero-padded numeric sequence beginning at `artifact-001`.
- Before writing an artifact, allocate the next available Artifact ID from the workflow index. The sequence is shared across `prompts/`, `handoffs/`, and `checkpoints/`.
- Artifact IDs are immutable and must not be reused or renumbered within a workflow.
- File names use `<artifact-id>-<descriptive-slug>.<artifact-type>.md`.
- Valid artifact-type suffixes are `prompt`, `handoff`, and `checkpoint`.
- Prompt slugs describe the assigned work or target; handoff slugs describe source-to-recipient routing; checkpoint slugs describe the workflow state captured.
- `index.md` records artifact relationships and chronological order. Related files do not share an Artifact ID.

Examples:

- `prompts/artifact-001-architecture-boundary-review.prompt.md`
- `handoffs/artifact-002-architecture-advisor-to-delivery-engineer.handoff.md`
- `checkpoints/artifact-003-after-red-increment-1.checkpoint.md`

Required `index.md` sections:

1. `Workflow Metadata` (workflow id, active owner, current artifact id, source-of-truth path, updated timestamp)
2. `Latest Prompt by Target Agent`
3. `Latest Return by Source Agent`
4. `Artifact Log (Chronological)` with newest entry first

Use `agent-docs/templates/workflow-artifact-index-template.md` as the default index scaffold.

Each artifact log entry is one terse row: timestamp, type (`worker-prompt` | `specialist-handoff` |
`checkpoint`), from → to, artifact id, repo-relative path, status note. One path per row.

## Artifact Cleanup On Closeout (Required)

To prevent unbounded artifact growth:

1. Close the workflow only after all normal completion gates pass.
2. Emit final user-facing closeout summary in the active session.
3. Delete `.agent-workflows/<workflow_id>/` (prompts, handoffs, checkpoints, and index).
4. Report `Artifact Cleanup Status: completed` or `Artifact Cleanup Status: failed (<reason>)`.
5. If cleanup fails, treat closeout as incomplete and rerun cleanup before final closure.

## Default Sequence

A feature slice runs in one primary context (the Delivery Engineer) as states, not a chain of
agents:

1. Intake and normalize the request.
2. Plan and lock the test strategy — `skills/feature-planning/` inline.
3. Consult `architecture-advisor` only if the Delegation Gate is met for an unresolved boundary
   decision.
4. For each increment — `skills/tdd-slice/` inline: RED (failing tests first), GREEN, REFACTOR,
   verify.
5. Generate the conservative review-lens manifest; load only `loadReferences` and apply every
   included lens inline via `skills/review-change/`.
6. A blocking finding routes scoped rework inline, then the manifest is regenerated before reruns.
7. Commit + push via the `commit-and-push` skill.

A dependency decision is assessed inline with `skills/dependency-assessment/`. A genuinely independent review
(auth / data-boundary change) may be dispatched to `independent-reviewer` per the Delegation Gate.

## Bug Workflow

Same one-context model:

1. Normalize the report.
2. Scope the fix and regression protection — `skills/feature-planning/` inline (consult
   `architecture-advisor` only if the Gate is met).
3. `skills/tdd-slice/` inline: produce failing `required_preimplementation_tests`, then apply the
   fix, then REFACTOR and verify.
4. Generate the review-lens manifest and apply its included lenses; route rework inline if required.
5. Commit + push; close or record follow-up.

## Workflow Dispatch Loop

For each cycle the workflow owner:

1. Selects the next step based on workflow state, keeping it in the primary context unless the Delegation Gate is met.
2. Records the step:
   - **In-context step:** a compact **Step Record** (`handoff-template.md`) — status, one-line Execution Profile Metadata, TDD state + last command/result, changed areas, new decisions, blockers, next action.
   - **Cross-context dispatch** (`delegation: advisor` / `independent` / `parallel`): a full **Cross-Context Handoff Package** — line 1 `Use agent spec: <alias>`, full Execution Profile Metadata, `Pass` with source-of-truth pointers (not copies), `Expect`, `Return Contract`.
3. Allocates the next Artifact ID and writes the record to `.agent-workflows/<workflow_id>/` (`prompts/`, `handoffs/`, or `checkpoints/`).
4. Updates `.agent-workflows/<workflow_id>/index.md` (latest-by-agent row + chronological log entry, single repo-relative path).
5. For a cross-context dispatch only: emit the bootstrap line (`Read and execute worker prompt at: <absolute_path>.`) and require the receiving context to acknowledge `Active Agent` + `Execution Profile` + `Reasoning Demand` + `Delegation` before it starts; reissue on a missing/mismatched acknowledgement.
6. Enforces the test-first gate state before any implementation step.
7. Ingests the result, updates workflow state, and routes the next step (including review-gate rework loops).
8. While status is `in-progress`, continues to the next step in the same cycle without waiting for a manual "next" request.

## Record Requirements

Every record obeys the **delta-only invariant**: for new workflows, link canonical
`slice-spec.json` by path/revision/hash and never copy its fields. Legacy workflows may link their
existing request/plan.

A **Step Record** includes: workflow id, source-of-truth path, status, one-line Execution Profile
Metadata, TDD state + last command/result, changed areas, new decisions, blockers, next action
(with `next_agent_alias` / `workflow_status` / `reentry_reason` when routing).

A **Cross-Context Handoff Package** additionally includes: line 1 `Use agent spec: <alias>` (from
the core alias map, never a path form), the full Execution Profile Metadata block
(`execution_profile`, `capability`, `reasoning_demand`, `delegation`, `risk`, `scope`,
`reversibility`, `verification`, `rationale`, plus `escalated_from`/`escalation_reason` when
escalated), a `Pass` section of source-of-truth pointers and current test-evidence values
(`capability_owners` keys in play, `required_preimplementation_tests`,
`preimplementation_failing_test_evidence`, `e2e_status` — one line each), an explicit `Expect`, a
`Return Contract` with `Return To Agent` (default `delivery-engineer.agent.md`), and a
`Completion Signal`.

## Test-First and Evidence Gates

Implementation is not ready to start until all are true:
- `capability_owners` is explicit with stack-defined required keys
- for frontend slices using `capability_owners.shared_client_state_owner`, `capability_owners.shared_client_state_tier` is explicit (`subtree` | `cross_feature`)
- `test_layer_matrix` exists for `unit`, `component`, `integration`, `e2e`
- each test layer is marked `required` or `N/A` with rationale
- `required_preimplementation_tests` are defined
- `preimplementation_failing_test_evidence` is recorded for required pre-implementation layers

Track gate state as:
- `Pending - test strategy handoff required`
- `Ready - test-first payload accepted`
- `Blocked - test-first evidence missing or incomplete`
- `Passed - implementation validated against test-first payload`

## Approval Boundaries

Pause and escalate when work requires:
- new dependencies
- new top-level architecture or broad refactors
- new environment/runtime assumptions
- material scope expansion
- contract changes that affect other consumers

## Checkpointing

Create a checkpoint when:
- a meaningful slice completes
- approval is needed
- a blocker prevents continuation
- context needs to be resumed later

Use `agent-docs/templates/checkpoint-template.md` (a compact Step Record). Keep it under ~30 lines
and reference the canonical slice spec rather than restating it.
Allocate the next Artifact ID before storing each checkpoint at `.agent-workflows/<workflow_id>/checkpoints/artifact-NNN-<descriptive-slug>.checkpoint.md`, then log it in `index.md`.

## Resume Procedure

When resuming from a fresh context:
1. Validate `ledger.jsonl` and rebuild `ledger-views/`, then load the compatibility `index.md` and
   latest checkpoint; record any shadow discrepancy as an exception event.
2. Read the canonical slice spec (or legacy request/plan) linked from the index — do not
   reconstruct it from artifacts.
3. Identify the pending step, its test-evidence state, and open blockers from the checkpoint.
4. Resume from the pending step, keeping it in the primary context unless the Delegation Gate is met.

## Fresh Context Protocol (Cross-Context Only)

Only when a step is actually picked up in a separate context, use this message format in the fresh window:

- `Read and execute worker prompt at: <absolute_path_to_.prompt.md>.`
- `Acknowledge with: Active Agent: <target>.agent.md, Execution Profile: <execution_profile>, Reasoning Demand: <reasoning_demand> (<reason>), Delegation: <delegation>.`

File selection rule: open `.agent-workflows/<workflow_id>/index.md`, find the row under `Latest
Prompt by Target Agent` for the intended worker, and copy that path into the bootstrap line.

## Completion Bootstrap (Cross-Context Dispatch / Reentry Only)

Only when handing off to a separate context or re-entering the workflow owner, output a
copy/paste-ready block:

- `Use agent spec: <target_alias>`
- `Active Agent: <source_alias>`
- `Execution Profile: <execution_profile>` / `Reasoning Demand: <reasoning_demand> (<reason>)` / `Delegation: <delegation>`
- `<one line naming the persisted artifact path>`
- `Continue workflow <workflow_id>.`

Validation: the alias must be in the core alias map, the artifact path must exist on disk and match
the persisted artifact, and `<workflow_id>` must match the active workflow. In-context steps do not
emit a bootstrap block — they just continue.

## Legacy Reasoning Mode Compatibility (Deprecated)

Some pre-update workflow artifacts persisted under `.agent-workflows/<workflow_id>/` may still carry the legacy `Reasoning Mode: Fast|High (<reason>)` contract. Treat this as deprecated compatibility input only:

1. Do not validate new dispatches or handoffs against the legacy `Reasoning Mode` contract; it is not a substitute for the Execution Profile Metadata block.
2. When resuming a workflow whose latest persisted artifact still uses `Reasoning Mode: Fast|High`, `delivery-engineer` must reissue the next Worker Prompt Package using the current Execution Profile Metadata contract before continuing the dispatch loop.
3. Never infer an `execution_profile` or `reasoning_demand` value from legacy `Fast`/`High` text; select a value using `agent-docs/routing/reasoning-selection-policy.md`.

## Closeout

A workflow is ready to close when:
- requested scope is complete or explicitly deferred
- validation status is known
- required `required_preimplementation_tests` are passing
- required `e2e_status` is `passing`
- required stack/repo review gates are complete with no blocking findings
- unresolved risks are recorded
- the final summary is understandable without replaying the whole thread
- `.agent-workflows/<workflow_id>/` artifact cleanup has completed successfully
