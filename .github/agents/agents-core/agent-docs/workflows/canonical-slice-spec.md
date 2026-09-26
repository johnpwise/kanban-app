# Canonical Slice Specification (Slice 2)

Every new feature or bug workflow owns one progressively populated canonical record:

`.agent-workflows/<workflow_id>/slice-spec.json`

The normative shape is
`agent-docs/schemas/slice-spec.schema.json`; the dependency-free writer and validator is
`scripts/slice-spec.mjs`. The request or bug report supplies intake data, inline planning enriches
the same record, RED execution captures evidence in it, and verification closes it out. Do not
create a second plan or test matrix that restates these fields.

## Contract

The record contains:

- identity, kind, monotonic revision, workflow status, timestamps, and planning complexity;
- objective, acceptance criteria, in/out scope, and typed observations for constraints, bug
  reproduction, evidence, risks, assumptions, and other intake context;
- append-only provenance entries distinguishing `user`, `inferred`, `repository`, and `approval`
  sources; every normative item points to one provenance entry;
- approval boundaries with immutable boundary/requirement text and append-only decisions;
- capability owners, the four-layer test matrix, ordered TDD increments, required tests, expected
  RED evidence, verification, and `e2eStatus`.

Omitted patch fields are retained. Identity cannot change, revisions and status cannot regress,
provenance cannot be rewritten, and an approval boundary or existing decision cannot be replaced.
Correct a provenance or approval fact by appending a new entry or decision. This prevents a later
planning or handoff step from silently erasing user intent or an approval boundary.

Acceptance criteria, scope items, and intake observations are append-only. Once planned, a test
layer cannot switch between `required` and `N/A`; test identity fields are immutable; increment,
RED-evidence, E2E, and completed-verification states cannot regress. Append a correction with new
provenance instead of rewriting an intake fact.

## Progressive gates

- `progressive`: validates the intake-safe structural contract while planning fields may be empty.
- `planned`: requires complexity, capability owners, all four test layers with `required`/`N/A`
  rationale, increments, required pre-implementation tests, matching expected RED entries, and
  verification.
- **implementation-ready**: additionally requires every approval boundary to be approved and every
  pre-implementation test's RED evidence to be captured with command, non-zero exit code, and
  observed failure.
- `closeout`: additionally requires verification to be `passing`/`N/A` and required E2E to be
  `passing`.

Stack overlays still define which capability-owner keys are required. The canonical core schema
keeps keys open so one source works across frontend and backend stacks.

## Commands

```sh
node .github/agents/agents-core/scripts/slice-spec.mjs validate \
  --spec .agent-workflows/<workflow_id>/slice-spec.json \
  --stage planned

node .github/agents/agents-core/scripts/slice-spec.mjs merge \
  --spec .agent-workflows/<workflow_id>/slice-spec.json \
  --patch /path/to/progressive-patch.json \
  --stage implementation-ready
```

The source-repository entry point is `node scripts/slice-spec.mjs`. `merge` validates the current
record, preserves omitted fields, increments `revision`, writes atomically, and validates the
requested gate before success.

## References from other workflow state

Intake, planning, Step Records, checkpoints, cross-context handoffs, and ledger events point to the
canonical path instead of copying objective, acceptance criteria, scope, approvals, owners, matrix,
increments, RED expectations, or verification. A new ledger starts with a `sliceSpec` reference
containing path, slice ID, revision, and content hash. Every later event retains that reference,
allowing only a non-regressing revision. Slice 1 ledgers without `sliceSpec` remain readable as a
compatibility path; a new Slice 2 workflow must not use that legacy omission.
