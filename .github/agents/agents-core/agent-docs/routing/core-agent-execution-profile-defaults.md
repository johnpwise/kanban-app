# Core Agent Execution Profile Defaults

## Purpose

Declares the default `execution_profile` for every core specialist agent, derived from the shared catalogue in [[execution-profile-policy]] and the procedures in [[reasoning-selection-policy]]. The delivery engineer (`delivery-engineer.agent.md`, alias `Delivery-Engineer`) uses these defaults as the starting point for every step and adjusts per the Reasoning-Demand Selection Procedure and the Delegation Gate before assigning final Execution Profile Metadata. Every core agent's default `delegation` is `inline`; the Delegation Gate decides when a specific dispatch is raised to `advisor`, `independent`, or `parallel`.

Stack packs may declare additional stack-specific specialists and profile refinements in their own `agent-docs/routing/model-routing-policy.md`; they must not redeclare or contradict the defaults below.

## Defaults

| Agent | Capability | Default profile | Default reasoning demand | Escalation |
| --- | --- | --- | --- | --- |
| `delivery-engineer.agent.md` (alias `Delivery-Engineer`) | `coordination` | `planning-routine` | `routine` | Escalate to `planning-elevated` when trigger blocks conflict, required workflow artifacts are missing, or an approval-boundary decision is surfaced. |
| `architecture-advisor.agent.md` (alias `Architecture-Planner`) | `analysis` | `architecture-elevated` | `elevated` | A wider blast radius (cross-cutting change, new integration boundary, migration-shaped or multi-system design) is recorded in `escalation_reason`; raise `reasoning_demand` to `deep` when the design reasoning itself is at the hardest tier. Raise `delegation` to `parallel` (`orchestration-independent-design-evaluation`) only when two or more viable approaches genuinely warrant independent evaluation before a decision. |
| `independent-reviewer.agent.md` | `analysis` | `review-routine` | `routine` | Escalate to `review-elevated` (or `deep`) when the diff is large or multi-finding, state ownership is questionable, architectural drift is evident, a contract change affects other consumers, or the path is security/transaction/concurrency-sensitive. Dispatched only when the Delegation Gate is met for the review itself; `delegation: independent`. |

Planning, test strategy, implementation, review, dependency assessment, commit authoring, and PR
authoring are no longer separate agents — they are inline states or skills of the delivery slice
(`skills/feature-planning/`, `skills/tdd-slice/`, `skills/review-change/`,
`skills/dependency-assessment/`, `skills/commit-and-push/`, `skills/create-develop-pr/`). Their
reasoning demand is selected the same way, per step: `planning-routine` / `testing-routine` /
`implementation-routine` / `review-routine` by default, raised to the matching `-elevated` (or
`deep`) when that step's own reasoning is genuinely hard — ambiguous scope or multiple viable
approaches for planning; async races or a contested matrix for test strategy; cross-module,
contract-ambiguous, or high-risk work (authentication, transactions, concurrency, migrations, broad
refactoring) for implementation. `implementation-lightweight` covers mechanical, deterministic
changes. A dependency assessment defaults to `planning-routine`, raised to `planning-elevated` when
the proposal affects production runtime, the build pipeline, licensing/compliance posture, or
broadly used developer tooling — those also escalate to the user for explicit approval. The commit
step is `delivery-lightweight` (→ `delivery-routine` when push fails or scope is ambiguous); an
explicitly requested PR is `delivery-routine` (re-enter as `awaiting-approval` for base-target or
repository-policy ambiguity).

## Application Rule

The delivery engineer starts from the default profile in this table, then applies the
Reasoning-Demand Selection Procedure in [[reasoning-selection-policy]] against the dispatch's actual
reasoning difficulty (using `risk`, `scope`, `reversibility`, and `verification` as recorded
judgement inputs), and separately applies the Delegation Gate to decide `delegation`. The default is
a starting point, not a ceiling: any dispatch may resolve higher, and a specialist may escalate
further per the Escalation Rules. No participant may silently downgrade an assigned
`reasoning_demand` or `delegation`.

Once the metadata is set, the delivery engineer applies the Realization Rule in
[[reasoning-selection-policy]]: `reasoning_demand` is advisory model/effort at every level and never
by itself forces a separate context; `delegation: inline` (the default for every core agent) runs in
the current context, and `advisor` / `independent` / `parallel` are dispatched through the `Agent`
tool with each subagent's model set from its own `reasoning_demand`.
