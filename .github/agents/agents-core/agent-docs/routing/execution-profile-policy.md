# Execution Profile Policy

## Purpose

Defines the shared, provider-neutral **reasoning-demand** vocabulary, the independent **delegation**
vocabulary, and the catalogue of activity-specific execution profiles that every dispatch must
select from. This document is the canonical source for `reasoning_demand`, `delegation`, and
`execution_profile` values referenced by [[execution-profile-schema]] and consumed by
[[reasoning-selection-policy]].

## Two Independent Axes

A dispatch is described by two axes that are chosen **separately**:

1. **`reasoning_demand`** — how much model capability and thinking budget the work needs.
2. **`delegation`** — whether the work runs in the current agent's context or as one or more
   separate agent contexts.

"Hard" does not imply "separate agent". A subtle, tightly-coupled problem is often best solved by
the primary agent at a high `reasoning_demand` and `delegation: inline`, because a fresh context
would lose everything already learned. Delegation is justified by *independence* and *second-opinion
value*, not by difficulty. See the Delegation Gate in [[reasoning-selection-policy]].

## Shared Reasoning-Demand Levels

Four levels. Each names a **model tier** and a **thinking budget** as separate sub-axes. The mapped
tier/budget is **advisory** at every level — it is applied when the active host exposes a
model/effort control, and otherwise recorded as an unbridged gap in the dispatch's `rationale`. The
level never, by itself, forces a separate agent context.

| Demand | Model tier | Thinking | Meaning | Typical examples |
| --- | --- | --- | --- | --- |
| `lightweight` | light | minimal | Mechanical, localised and deterministic work. | Version bump, rename, deterministic verification, small documentation correction. |
| `routine` | standard | standard | Normal bounded engineering following established patterns. The default. | Conventional endpoint, component, bounded refactor or straightforward tests. |
| `elevated` | deep | extended | Non-trivial reasoning with several viable approaches, an unfamiliar area, a cross-module or contract change, or high-risk / hard-to-reverse consequences. | Unknown repository area, authentication / transaction / concurrency / migration work, non-trivial debugging, cross-module refactor. |
| `deep` | deep | maximum | The hardest subset of reasoning work: subtle, tightly-coupled, or severe-consequence problems where maximum single-context effort is warranted. | System-wide or security-sensitive design, a defect resisting normal diagnosis, a design with several strong competing approaches to weigh. |

Each level picks a default model-tier / thinking-budget pair. A dispatch that needs a non-default
pairing (for example a deep model at a quick thinking budget) records that in its `rationale` line;
there is no separate metadata field for it.

`deep` is the top **reasoning** level, not a delegation instruction. Fanning work out across several
agents is `delegation: parallel`, chosen independently and only when the Delegation Gate is met.

## Delegation Levels

Four levels, chosen independently of `reasoning_demand`:

| Delegation | Meaning | Realization |
| --- | --- | --- |
| `inline` | The dispatch runs in the current agent's context. **The default.** | No separate context. The current agent does the work, applying the advisory model/effort for its `reasoning_demand`. |
| `advisor` | A separate context produces analysis or an opinion that returns to the primary agent, which keeps ownership of the work. | One subagent dispatch; its result is consumed by the primary agent. |
| `independent` | A separate context performs and verifies a genuinely separable unit of work end to end (for example an independent review of a completed diff). | One subagent dispatch that owns its unit and returns a verdict/result. |
| `parallel` | Two or more separate contexts run concurrently on genuinely independent, separately-verifiable workstreams. | Several coordinated subagent dispatches per the Delegation Gate. |

`advisor`, `independent`, and `parallel` are realized through the platform's subagent mechanism
(the `Agent` tool on Claude Code, native sub-tasks on Codex), with each subagent's model set from
its own `reasoning_demand` via the active platform mapping. `inline` needs no platform mechanism.

## Activity-Specific Execution Profile Catalogue

Each profile declares a default `reasoning_demand`, entry criteria for when the profile applies, and
the trigger that raises a dispatch to the next-higher demand level within the same activity. Default
`delegation` is `inline` for every profile unless its entry text says otherwise; the Delegation Gate
in [[reasoning-selection-policy]] decides when to raise it. All profiles inherit the
no-silent-downgrade rule in [[reasoning-selection-policy]].

### exploration

Understanding existing code, requirements, or system behavior with no code changes produced.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `exploration-routine` | `routine` | Locating known patterns or symbols in a familiar area of the codebase. |
| `exploration-elevated` | `elevated` | Unfamiliar repository area, ambiguous requirements, or reconciling conflicting documentation. |

Raise to `exploration-elevated` when initial findings reveal cross-module coupling or contradictory
existing behavior.

### planning

Converting intent into a structured, scoped request.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `planning-routine` | `routine` | Well-understood feature or bug shape with clear acceptance criteria. |
| `planning-elevated` | `elevated` | Multiple viable approaches, unclear ownership, or missing constraints requiring assumption-making. |

Raise to `planning-elevated` when scoping surfaces an approval-boundary decision (new dependency, new
architecture, contract change).

### architecture

Structural or cross-module design decisions.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `architecture-elevated` | `elevated` | Any structural or cross-module design decision: bounded-module design with known precedent, a cross-cutting structural change, a new integration boundary, migration-shaped design, or a multi-system decision with system-wide, hard-to-reverse consequences. |

Architecture work has no routine tier. A genuinely bounded, additive change with a stable transport
shape is `planning-routine`, not architecture. When a design decision's blast radius extends beyond
the modules originally scoped, record it in `escalation_reason` at the same `architecture-elevated`
level, and raise to `reasoning_demand: deep` only when the reasoning itself is at the hardest tier.
Use `delegation: advisor` when the primary agent wants an independent structural opinion but keeps
ownership; use `delegation: parallel` only when two or more viable approaches genuinely warrant
independent evaluation before a decision (see the Delegation Gate).

### testing

Defining and authoring pre-implementation and regression test coverage.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `testing-routine` | `routine` | Standard `test_layer_matrix` for a conventional, bounded change. |
| `testing-elevated` | `elevated` | Async races, multiple interacting UI/system states, or contested `test_layer_matrix` decisions. |

Raise to `testing-elevated` when required test layers are contested or
`preimplementation_failing_test_evidence` is missing or contradictory.

### implementation

Producing code changes against an accepted plan and test-first payload.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `implementation-lightweight` | `lightweight` | Deterministic, mechanical change (version bump, rename, small correction). |
| `implementation-routine` | `routine` | Conventional endpoint, component, or bounded refactor following established patterns. |
| `implementation-elevated` | `elevated` | Cross-module implementation, a contract change with several viable approaches, or high-risk work — authentication, transactions, concurrency, migrations, or broad refactoring. |

Raise one level when implementation uncovers risk or scope beyond the assigned profile; never
silently continue at the original level. Implementation stays `delegation: inline` by default — a
change touching several files or modules is not, by itself, a reason to delegate.

### debugging

Diagnosing defective or unexpected behavior.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `debugging-routine` | `routine` | Reproducible defect with a known, bounded cause. |
| `debugging-elevated` | `elevated` | Non-trivial defect requiring cross-module investigation, diagnostic work touching concurrency / transactions / authentication, or severe production diagnosis with system-wide or security-sensitive impact. |

Raise to `debugging-elevated` (or `deep` when diagnosis resists elevated effort) when root cause is
traced outside the originally scoped module or layer. Use `delegation: parallel` only when there are
two or more genuinely independent candidate root causes that can be investigated without shared
state.

### review

Reviewing produced work for correctness, quality, or policy compliance.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `review-routine` | `routine` | Small, single-purpose diff with local impact and no approval-boundary concerns. |
| `review-elevated` | `elevated` | Large diff, multiple interacting findings, or questionable ownership/architectural drift. |

A review lens applied by the agent that wrote the code is `delegation: inline`. Use
`delegation: independent` when an isolated second opinion on a completed diff materially raises
confidence (for example an authorization or data-boundary change). Use `delegation: parallel` only
when several review disciplines genuinely need concurrent, independent coverage.

### verification

Confirming that implemented work satisfies acceptance criteria and evidence gates.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `verification-lightweight` | `lightweight` | Deterministic check (lint, type-check, single test run) with an unambiguous pass/fail result. |
| `verification-routine` | `routine` | Standard test-first evidence and `e2e_status` confirmation for a bounded change. |
| `verification-elevated` | `elevated` | Verification spans multiple test layers with ambiguous or borderline evidence. |

Raise to `verification-elevated` when required evidence is incomplete, contradictory, or spans
unexpected layers.

### delivery

Commit authoring, push, and (when explicitly requested) pull-request authoring.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `delivery-lightweight` | `lightweight` | Standard commit/push with clean gate status and no PR request. |
| `delivery-routine` | `routine` | Explicit PR authoring request, or commit/push following a rework loop. |

Raise to `delivery-routine` when push fails, requires investigation, or an explicit PR request is
present.

### orchestration

The profile for the **coordinating** dispatch when a workflow fans work out across concurrent,
independent subagents (`delegation: parallel`). It does not describe the parallel workstreams
themselves — each of those carries its own activity profile.

| Profile | Default demand | Entry criteria |
| --- | --- | --- |
| `orchestration-parallel-investigation` | `elevated` | Coordinating two or more independent investigations (for example multiple candidate root causes) that proceed concurrently without shared-state conflicts. |
| `orchestration-independent-design-evaluation` | `elevated` | Coordinating independent evaluation of two or more viable architectural approaches before a decision. |
| `orchestration-multi-specialist-review` | `elevated` | Coordinating multiple review disciplines (for example security, accessibility, performance) that apply independently to the same delivered work. |

These profiles are valid only with `delegation: parallel` and a demonstrable decomposition benefit;
see the Delegation Gate in [[reasoning-selection-policy]]. Raise the coordinating dispatch's
`reasoning_demand` to `deep` only when the coordination reasoning itself is at the hardest tier.

## Cross-Cutting Rule

`routine` / `inline` is the default assumption for bounded engineering and review work. Selecting
`elevated` or `deep` requires explicit reasoning-difficulty evidence (several viable approaches, an
unfamiliar area, high-consequence or subtle reasoning) recorded in the dispatch's `rationale`.
Selecting any `delegation` other than `inline` requires the Delegation Gate to be met and the
justification recorded. The two decisions are made independently, per [[reasoning-selection-policy]].
