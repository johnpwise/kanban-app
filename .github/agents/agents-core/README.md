# Agents Core Pack

This pack is the shared core layer for the delivery-slice workflow: one primary agent (the Delivery
Engineer) owns a feature or bug slice end-to-end, with two conditional agents and a set of inline
skills.

## Intended layering

`agents-core` -> stack pack (`agents-react`, `agents-node-express`, etc.) -> repo-local overlay

The core pack owns reusable workflow fundamentals:
- the Delivery Engineer, Architecture Advisor, and Independent Reviewer agents
- the inline skills (`skills/feature-planning/`, `skills/tdd-slice/`, `skills/review-change/`,
  `skills/dependency-assessment/`, `skills/commit-and-push/`, `skills/create-develop-pr/`)
- execution-profile routing and the Delegation Gate
- shared handoff and checkpoint templates

Stack packs should add stack-specific specialist agents and policy. Repo-local overlays should add project facts, exceptions, and approval boundaries.

## Included in this pack

### Agents
- `delivery-engineer.agent.md` — the Delivery Engineer (alias `Delivery-Engineer`); owns a slice end-to-end in one context
- `architecture-advisor.agent.md` — consulted only when the Delegation Gate is met; returns an advisory result under a 500-word budget (accepts the legacy alias `Architecture-Planner`)
- `independent-reviewer.agent.md` — applies `skills/review-change/` from a fresh context, only when the Delegation Gate is met for the review

The Delivery Engineer and Architecture Advisor are the only core agents. Planning, test strategy,
implementation, review, dependency assessment, commit authoring, and PR authoring are inline skills:
`skills/feature-planning/`, `skills/tdd-slice/`, `skills/review-change/`,
`skills/dependency-assessment/`, `skills/commit-and-push/`, `skills/create-develop-pr/`. The retired
`Feature-Plan-Delivery-Orchestrator`, `Test-Strategy-Engineer`, `Implementation-Engineer`,
`Dependency-Governance`, `Commit-Authoring-Operator`, `Pull-Request-Author-Operator`, and the
per-stack reviewer / guardian aliases still resolve (to the Delivery Engineer) for one release.

### Docs
- `routing/agent-spec-alias-map.md`
- `routing/execution-profile-schema.md`
- `routing/execution-profile-policy.md`
- `routing/reasoning-selection-policy.md`
- `routing/core-agent-execution-profile-defaults.md`
- `routing/execution-profile-worked-examples.md`
- `routing/execution-profile-v2-validation-report.md`
- `routing/model-routing-policy.md`
- `checklists/pr-ready-checklist.md`
- `workflows/handoff-workflow.md`
- `workflows/feature-workflow-routing.md`
- `workflows/bug-workflow-routing.md`
- `standards/architecture/frontend-state-ownership-standards.md`
- `standards/coding/coding-standards-shape.md`
- `standards/reliability/frontend-styling-and-accessibility-standards.md`
- `prompts/delivery-engineer-auto-loop.prompt.md`
- `prompts/feature-intake-baseline.prompt.md`
- `prompts/bug-intake-baseline.prompt.md`
- `prompts/backend-bug-sweep.prompt.md`
- `templates/handoff-template.md`
- `templates/workflow-artifact-index-template.md`
- `templates/feature-request-template.md`
- `templates/bug-report-template.md`
- `templates/checkpoint-template.md`

## Usage

1. Pull in `agents-core` first as the workflow backbone.
2. Add one or more stack packs for framework or domain-specific guidance.
3. Keep repo facts and exceptions in the local repo `AGENTS.md`.
4. In repo-local overlays, map stack-defined `capability_owners` keys and `test_layer_matrix` execution to concrete package/tool choices.
5. For frontend stacks using `capability_owners.shared_client_state_owner`, include `capability_owners.shared_client_state_tier` (`subtree` | `cross_feature`) in new/updated frontend slices.
6. Use core handoff and checkpoint templates to keep workflows resumable and reviewable.
7. Record each step with the core `handoff-template.md` — a compact **Step Record** in-context, a full **Cross-Context Handoff Package** only for a dispatch to a separate agent context.
8. Keep `delivery-engineer` as default return target unless the active handoff explicitly overrides it.
9. Keep stack-specific or repo-specific rules out of `agents-core` unless they are truly cross-stack.
10. Persist workflow artifacts to `.agent-workflows/<workflow_id>/` and route fresh contexts by index-resolved absolute prompt paths.
11. Delete `.agent-workflows/<workflow_id>/` after closeout to prevent artifact buildup.
12. Select an execution profile (`routing/execution-profile-schema.md`, `routing/execution-profile-policy.md`, `routing/reasoning-selection-policy.md`) alongside the agent alias for every dispatch. `reasoning_demand` (`lightweight`, `routine`, `elevated`, `deep` — how hard the thinking is) and `delegation` (`inline`, `advisor`, `independent`, `parallel` — whether a separate agent context does the work) are chosen independently; profiles may vary between successive dispatches, and neither axis may be silently downgraded once assigned.
13. Realize per the active platform's mapping doc (`platforms/claude-code/execution-profile-mapping.md` or `platforms/codex/execution-profile-mapping.md`, installed as siblings of this pack): `reasoning_demand` is advisory model/effort at every level and never by itself forces a separate context; `delegation: inline` runs in the primary context, and `advisor`/`independent`/`parallel` are dispatched through the `Agent` tool with each subagent's model set from its own `reasoning_demand`. This pack stays platform-neutral and never names a concrete model.

## Adoption notes

When downstream repos upgrade workflow behavior, copy these core files together to avoid mixed policy states:

- if a stack overlay enforces feature/bug intake triggers (for example `New Feature` and `Bug Fix`), update `agents/delivery-engineer.agent.md` together with that stack's feature-routing/feature-intake and bug-routing/bug-intake docs
- when changing mandatory feature/bug work-branch preflight policy, update the core routing and intake documents together with every bootstrapper's generated root `AGENTS.md` and `README.md` defaults

Copy these files together:

- `agent-docs/workflows/feature-workflow-routing.md`
- `agent-docs/workflows/bug-workflow-routing.md`
- `agent-docs/workflows/handoff-workflow.md`
- `agent-docs/templates/handoff-template.md`
- `agent-docs/templates/bug-report-template.md`
- `agents/delivery-engineer.agent.md`
- `AGENTS.md`

Also keep these together whenever the shared execution-profile contract changes, since `delivery-engineer.agent.md` and `handoff-template.md` require the fields they define:

- `agent-docs/routing/execution-profile-schema.md`
- `agent-docs/routing/execution-profile-policy.md`
- `agent-docs/routing/reasoning-selection-policy.md`
- `agent-docs/routing/core-agent-execution-profile-defaults.md`
- `../platforms/claude-code/execution-profile-mapping.md` and `../platforms/codex/execution-profile-mapping.md` (siblings of this pack, not inside it) — update whenever the shared reasoning-demand levels change, so every level still resolves on both platforms

## Design notes

This first pass is intentionally conservative:
- it keeps one primary context owning a slice end-to-end (plan/test/implement/verify/review as states), delegating only when the Delegation Gate is met
- it keeps core guidance stack-neutral
- it favors small slices, explicit approvals, and reversible changes
- it separates reusable process standards from stack and repo policy
