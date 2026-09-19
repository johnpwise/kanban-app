# Agent Spec Alias Map

This is the canonical alias map for `Use agent spec: <Agent-Spec-Alias>`.

Rules:
- Aliases use Title-Hyphenated format and are globally unique.
- `Use agent spec` must use an alias, never a path form.
- Paths below use `.github/agents/...` as canonical notation and may resolve through equivalent active repo layout paths.

## Live agents

The framework ships **three** agents. `Delivery-Engineer` owns a delivery slice end-to-end in one
primary context; `Architecture-Advisor` and `Independent-Reviewer` are consulted only when the
Delegation Gate is met. Stack packs ship no agents.

| Alias | Agent spec path |
| --- | --- |
| `Delivery-Engineer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` |
| `Architecture-Advisor` | `.github/agents/agents-core/agents/architecture-advisor.agent.md` |
| `Independent-Reviewer` | `.github/agents/agents-core/agents/independent-reviewer.agent.md` |

## Backwards-compatible name aliases (retained one release)

Prior names for the same live agents — existing trigger blocks keep working. New trigger blocks
should use the live alias.

| Legacy alias | Resolves to |
| --- | --- |
| `Workflow-Orchestrator` | `Delivery-Engineer` |
| `Architecture-Planner` | `Architecture-Advisor` |

## Deprecated aliases (retained one release)

These agents were folded into `Delivery-Engineer` + inline skills. The aliases still resolve so
existing trigger blocks keep working; they route to the Delivery Engineer, which applies the named
skill inline. An `independent` review dispatch uses `Independent-Reviewer`, not these aliases.

| Alias | Resolves to | Superseded by |
| --- | --- | --- |
| `Feature-Plan-Delivery-Orchestrator` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/feature-planning/` |
| `Test-Strategy-Engineer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/feature-planning/` |
| `Implementation-Engineer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/tdd-slice/` |
| `Dependency-Governance` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/dependency-assessment/` |
| `Commit-Authoring-Operator` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/commit-and-push/` |
| `Pull-Request-Author-Operator` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/create-develop-pr/` |
| `Backend-Code-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Backend-Error-Handling-And-Observability-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Backend-Persistence-And-Transaction-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Backend-Route-Handler-Boundary-Guardian` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Backend-Ts-Code-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Backend-Ts-Error-Handling-And-Observability-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Backend-Ts-Persistence-And-Transaction-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Backend-Ts-Route-Handler-Boundary-Guardian` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Frontend-Code-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Frontend-Accessibility-Ux-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Frontend-React-State-Ownership-Guardian` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Frontend-React-Component-Composition-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Frontend-Vue-Code-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Frontend-Vue-Accessibility-Ux-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Frontend-Vue-State-Ownership-Guardian` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Frontend-Vue-Component-Composition-Reviewer` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/` |
| `Backend-Api-Contract-Modeling` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/references/api-contracts.md` |
| `Backend-Ts-Api-Contract-Modeling` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/references/api-contracts.md` |
| `Frontend-Api-Contract-Modeling` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/references/api-contracts.md` |
| `Frontend-Vue-Api-Contract-Modeling` | `.github/agents/agents-core/agents/delivery-engineer.agent.md` | `skills/review-change/references/api-contracts.md` |

Every stack specialist listed above was folded into `skills/review-change/` and its `references/`;
the stack packs ship no agent files. `Architecture-Planner` (renamed to `Architecture-Advisor`,
not folded) is in the Backwards-compatible name aliases table above.
