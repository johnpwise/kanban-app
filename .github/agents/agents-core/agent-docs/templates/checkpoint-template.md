# Workflow Checkpoint Template

A checkpoint is a **Step Record** (see `handoff-template.md`) written to snapshot state for a safe
pause/resume. It follows the same delta-only invariant: **reference the canonical
`slice-spec.json` by path, revision, and hash; do not restate its fields.** Legacy workflows may
link their existing request/plan instead.

In Slice 1 shadow mode, also append a `checkpoint-recorded` event. `ledger-views/checkpoints/latest.md`
is derived from it and must rebuild byte-for-byte after loss; the compatibility checkpoint remains
beside it until cutover.

Create a checkpoint only when it earns its cost: a meaningful slice/increment completed, approval
is needed, a blocker was hit, or work must pause and resume later. Not on every step.

## Shape

```
Workflow: <workflow_id>
Source of truth: <path-to-request-or-plan>[#heading]
Status: in-progress | blocked | awaiting-approval | ready-to-resume | closed
As of: <UTC>

Position: <current increment / activity> → next: <next action>

Done since last checkpoint:
- <deltas only — completed work, files touched>
Decisions since last checkpoint:
- <new decisions only>

Validation state (current values, one line each):
- test_layer_matrix / required_preimplementation_tests / preimplementation_failing_test_evidence: <status or "see source of truth">
- e2e_status: planned | authored | passing | N/A
- last test run: <command> → <result>

Blockers / approvals needed: <none | bullets>
Assumptions to carry forward: <none | bullets>

Resume here: <one or two lines — what to do first, what not to redo>
```

Budgets (see the Artifact budgets table in `handoff-template.md`): a GREEN-increment checkpoint is
100–250 words; a blocker checkpoint 300; a closeout summary 500. Exceeding a ceiling needs a one-line
`Budget note:` in the checkpoint. If a checkpoint keeps growing, the missing structure belongs in
the canonical slice spec, not the checkpoint.
