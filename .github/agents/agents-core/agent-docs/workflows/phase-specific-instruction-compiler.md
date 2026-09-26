# Phase-Specific Instruction Compiler

Slice 4 compiles one flattened effective instruction bundle for a selected stack, request route,
phase, and set of specialist triggers. Consumers read that bundle; they do not resolve a
base-plus-delta instruction chain themselves.

## Rollout state

The compiler kernel starts in **shadow mode**. Existing core, stack, repo, route, skill, and
specialist documents remain authoritative until all supported stack and feature/bug route goldens
prove equivalent, omission checks pass, and the 30% static-instruction reduction gate passes.
Shadow bundles must not weaken, replace, or bypass an existing gate.

## Manifest and precedence contract

The manifest follows `agent-docs/schemas/instruction-compiler-manifest.schema.json`.

- Every fragment owns one stable `policyId` and one Markdown source.
- Applicable fragments are selected only from the explicit `stack`, `requestType`, `phase`, and
  trigger context.
- Higher numeric layer precedence wins only when the higher fragment names the displaced fragment
  in `overrides`. An implicit conflict fails closed.
- A fragment marked `protected` cannot be overridden. Protected core safeguards include approval,
  test-first, branch-safety, review, evidence, and explicit-only action boundaries.
- Repo facts may override a non-protected stack default explicitly; phase procedures and specialist
  standards cannot silently override governance.
- Every active requirement lists policy IDs that must survive compilation. A missing policy fails
  the omission check and no bundle is emitted.

The flattened bundle records the selection, ordered precedence table, manifest hash, each selected
source hash, winning override metadata, required policy IDs, and a hash of the effective Markdown.
Hashes are SHA-256 over the exact UTF-8 source or flattened content.

## Commands

In an installed pack:

```sh
node .github/agents/agents-core/scripts/instruction-compiler.mjs compile \
  --repo-root . \
  --manifest <manifest-path> \
  --stack <stack> \
  --request-type <feature|bug> \
  --phase <phase> \
  --trigger <trigger> \
  --output .agent-workflows/<workflow_id>/effective-policy.md
```

Use `check` with the same selection and `--golden <snapshot.md>` to fail on any byte-level drift.
The source-repository entry point is `node scripts/instruction-compiler.mjs`.

## Cutover gate

Do not make compiled bundles authoritative until validators cover every supported stack and both
feature and bug routes, every required phase skill and triggered specialist standard has an
omission rule, golden effective-policy snapshots are approved, bootstrap-copy simulations pass,
protected invariants pass, and every representative route saves at least 30% against Slice 0.
