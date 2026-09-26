# Conservative review-lens manifest

Before review, generate `.agent-workflows/<workflow_id>/review-lens-manifest.json` from the
canonical slice spec and the completed diff. The dependency-free classifier is
`scripts/review-lens-manifest.mjs`; its output contract is
`agent-docs/schemas/review-lens-manifest.schema.json`.

## Invariants

- Correctness (`correctness`) is always `include`.
- Classification is conservative: an opaque or otherwise uncertain production change includes
  every conditional lens available to that stack.
- The deterministic result is a floor. A model may add a skipped stack lens with a rationale but
  may never remove a selected lens.
- Every skipped lens carries a machine reason code. The normal negative result is
  `NO_TRIGGER_IN_DIFF_OR_SLICE_SPEC`.
- `loadReferences` contains exactly correctness plus the triggered or model-added lens reference
  files. Paths are relative to the active `review-change` skill's `SKILL.md`, so they resolve under
  either `.agents/skills/review-change/` or `.claude/skills/review-change/`. Do not load skipped
  reference files.
- The manifest binds the decision to the slice-spec revision/hash and diff file list/hash. Rebuild
  it after rework changes the diff, then rerun every lens touched by that rework.

## Commands

Capture the completed unified diff, then classify and validate it:

```sh
git diff --no-ext-diff <base>...HEAD > /tmp/review.diff
node .github/agents/agents-core/scripts/review-lens-manifest.mjs classify \
  --stack <react|vue|nextjs|node-express|node-express-ts> \
  --spec .agent-workflows/<workflow_id>/slice-spec.json \
  --diff /tmp/review.diff \
  --output .agent-workflows/<workflow_id>/review-lens-manifest.json
node .github/agents/agents-core/scripts/review-lens-manifest.mjs validate \
  --manifest .agent-workflows/<workflow_id>/review-lens-manifest.json
```

The source-repository entry point is `node scripts/review-lens-manifest.mjs`. If inspection finds a
concern the deterministic rules did not select, add it monotonically:

```sh
node scripts/review-lens-manifest.mjs add \
  --manifest .agent-workflows/<workflow_id>/review-lens-manifest.json \
  --lens api-contracts:"Public DTO exposure requires contract review"
```

Record the manifest path/hash and review results in the ledger/Step Record. The manifest replaces
manual lens classification prose; it does not replace findings, rework evidence, or the rule that
all included lenses must pass before commit.
