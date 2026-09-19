# delivery-engineer-auto-loop.prompt.md

Use this prompt when you want workflow steps to run to closeout without stopping for a manual
"next" between each step.

## How the loop runs

- One primary context owns the whole slice: intake → plan → BDD → RED → GREEN → REFACTOR → verify →
  review lenses → commit. TDD phases are states, not separate agents.
- Delegate to a separate agent context **only** when the Delegation Gate in
  `.github/agents/agents-core/agent-docs/routing/reasoning-selection-policy.md` is met (genuine
  independence, material second-opinion value, context pollution, or an unresolved specialised
  decision). File count, module count, and "non-trivial" are not reasons.
- Persist a compact **Step Record** per step under `.agent-workflows/<workflow_id>/` (delta-only —
  link the request/plan/acceptance criteria, do not restate them). Emit `Saved Artifact` +
  `Workflow Index` paths; emit a Fresh Context Bootstrap / completion block only for a cross-context
  dispatch or a reentry state.
- Do not change production behaviour before the required RED evidence exists.

## Bug workflow starter

```text
Use agent spec: Delivery-Engineer
Bug Fix
<bug summary>
```

## Feature workflow starter

```text
Use agent spec: Delivery-Engineer
New Feature
<feature summary>
```

## Continuation turn template

```text
Continue workflow <workflow_id> and run the next step to closeout.
```
