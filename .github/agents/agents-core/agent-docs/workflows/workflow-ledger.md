# Workflow Event Ledger (Slice 1 shadow mode)

The append-only `ledger.jsonl` is the structured recovery record for a delivery workflow. During
shadow mode it is written **beside** the existing Markdown prompts, handoffs, checkpoints, and
`index.md`; those compatibility artifacts remain required until a later cutover explicitly removes
them. The ledger is not permission to relax intake, TDD, review, approval, branch, or closeout gates.

## Runtime layout

```text
.agent-workflows/<workflow_id>/
  slice-spec.json                      # canonical progressive Slice 2 contract
  ledger.jsonl                         # append-only source for Slice 1 views
  ledger-views/                        # disposable, atomically replaced projections
    index.md
    checkpoints/latest.md
    handoffs/event-NNNNNN.md
    closeout.md
  index.md                             # existing compatibility index during shadow mode
  prompts/ ... handoffs/ ... checkpoints/ ...
```

Use `.github/agents/agents-core/scripts/workflow-ledger.mjs` in an installed pack (or
`scripts/workflow-ledger.mjs` in this source repository). Each append validates the event, allocates
the next immutable `event-NNNNNN` ID, links `previousHash`, appends and fsyncs one JSON line, then
rebuilds the views. The fsynced ledger line is the commit point; an interrupted view render is
repaired with `rebuild` or `recover`.

## Event contract

The normative persisted shape is
`agent-docs/schemas/workflow-ledger-event.schema.json`. Every event carries workflow identity,
timestamp, actor, status, source-of-truth pointer, summary, next action, commands with integer exit
codes, SHAs, changed areas, decisions, risks, and free-form exceptions. Empty arrays are explicit.
Blockers and approval outcomes are first-class arrays rather than being hidden in narrative text.
Event-specific payloads add TDD state, execution-profile/routing metadata, source pointers,
expected return, or the dispatch event being returned.

New Slice 5 dispatch events persist `executionProfileId` only. The ID resolves through the
workflow's hash-validated `execution-profile-cache.json`; derived handoffs expand the full metadata
from that cache. Legacy `executionProfile` objects remain readable as a compatibility path.

Every new Slice 2 workflow event also carries `sliceSpec` (`path`, `sliceId`, `revision`, `hash`).
The path and slice ID remain stable, revisions never regress, and a hash cannot change without a
revision change. This reference replaces copied request/plan/test-matrix prose. Existing Slice 1
ledgers without it remain readable only as a compatibility path.

Event types are:

- `workflow-started`
- `step-recorded`
- `checkpoint-recorded`
- `dispatch-created`
- `handoff-returned`
- `exception-recorded`
- `closeout-recorded`

History is immutable. Correct a mistake by appending a new event whose decision or exception names
the superseded event; never edit, reorder, truncate, or renumber ledger lines.

## Cross-context dispatch

A `dispatch-created` event contains the complete dispatch contract and produces
`ledger-views/handoffs/<event-id>.md`. Dispatch becomes durable in the same append that records its
routing and evidence. The receiving context validates the event ID and ledger hash shown in the
view, then begins work; **no acknowledgement round-trip is required**. A result appends one
`handoff-returned` event with `dispatchEventId`. Missing or corrupt hashes fail closed, while an
unreturned dispatch remains visible as `pendingDispatch` during recovery.

This replaces the acknowledgement ritual only for the ledger shadow path. It does not change the
Delegation Gate, assigned reasoning/delegation floor, target alias validation, or return contract.

## Commands

```sh
node .github/agents/agents-core/scripts/workflow-ledger.mjs append \
  --workflow-dir .agent-workflows/<workflow_id> \
  --event-file /path/to/event.json

node .github/agents/agents-core/scripts/workflow-ledger.mjs validate \
  --workflow-dir .agent-workflows/<workflow_id>

node .github/agents/agents-core/scripts/workflow-ledger.mjs recover \
  --workflow-dir .agent-workflows/<workflow_id>
```

`recover` validates the complete hash chain, rebuilds all derived views, and prints the current
state including the last command, accumulated changed areas, and any pending dispatch. During
shadow mode, compare the derived views with their existing Markdown counterparts and record any
discrepancy as an `exception-recorded` event; the compatibility artifact remains authoritative for
dispatch until equivalence is proven.
