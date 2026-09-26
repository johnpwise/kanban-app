# Deterministic Execution-Profile Router

Slice 5 resolves the semantic execution profile once at a phase boundary and persists it in
`.agent-workflows/<workflow_id>/execution-profile-cache.json`. Normal-path records carry only the
content-addressed `ep-<12 hex>` profile ID. The cache is the expansion source for the complete
platform-neutral profile.

## Boundary and cache contract

- Resolve on entry to planning, testing/RED, implementation/GREEN or REFACTOR, debugging, review,
  verification, delivery, or an explicitly named architecture/orchestration boundary.
- Reuse the boundary entry byte-for-byte while its structured evidence is unchanged.
- Re-evaluate an existing boundary only when a new risk signal or a higher delegation request is
  supplied. Removing evidence never silently lowers the cached profile.
- A lower `reasoning_demand` or `delegation` within one boundary requires a recorded downgrade
  reason plus `acknowledged: true`. A new phase boundary resolves independently because it is a new
  dispatch, not a downgrade of the prior phase.
- `parallel` requires two or more named, independently verifiable workstreams.

The cache and each profile ID are content-addressed. Cache reads fail on a hash mismatch, a profile
whose content does not match its ID, a duplicate boundary, or a boundary that references a missing
profile.

## Compact emission rule

Routine inline selection emits only the profile ID. The structured evidence retained in the cache
is the deterministic explanation for that selection. Free-form `rationale` is added only when the
selection records an escalation, an exception, acknowledged downgrade, or non-inline delegation.
Legacy ledger events containing a complete `executionProfile` object remain readable; new events
use `executionProfileId` and derive full cross-context handoff metadata from the cache.

## Commands

```sh
node .github/agents/agents-core/scripts/execution-profile-router.mjs resolve \
  --workflow-dir .agent-workflows/<workflow_id> \
  --input /path/to/selection.json

node .github/agents/agents-core/scripts/execution-profile-router.mjs validate \
  --workflow-dir .agent-workflows/<workflow_id>
```

The source-repository entry point is `node scripts/execution-profile-router.mjs`. The persisted
shape is defined by `agent-docs/schemas/execution-profile-cache.schema.json`.
