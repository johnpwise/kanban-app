# Reasoning Selection Policy

## Purpose

Defines two independent structured procedures: one for selecting and escalating `reasoning_demand`,
and one for deciding `delegation`. Together with [[execution-profile-schema]] and
[[execution-profile-policy]] this is the complete contract for the Execution Profile Metadata block.
This policy is platform-neutral; it produces shared semantic metadata only and never a concrete
model or platform effort label.

## Core Principle: Reasoning ≠ Delegation

`reasoning_demand` is *how hard the thinking is*. `delegation` is *whether a separate agent context
does it*. These are decided separately:

- A subtle, tightly-coupled, or high-consequence problem raises `reasoning_demand` — often to
  `elevated` or `deep` — while staying `delegation: inline`, because the primary agent has already
  built the context the problem needs and a fresh agent would have to rebuild it.
- Delegation is earned by *independence* and *second-opinion value*, not by difficulty, file count,
  or module count.

## Reasoning-Demand Selection Procedure

`routine` is the default. For every dispatch, raise the level only when the work genuinely calls for
it, and record the judgement in the phase cache's structured evidence (plus free-form `rationale`
only for escalation, exception, acknowledged downgrade, or non-inline delegation):

1. Use `lightweight` when the work is mechanical and deterministic (rename, version bump, a
   single-line correction against a pre-written failing test).
2. Use `routine` for normal bounded engineering following established patterns. **This is the
   default and covers the large majority of dispatches.**
3. Raise to `elevated` when at least one is genuinely true, and say which in `rationale`:
   - several viable approaches must be weighed;
   - the area is unfamiliar or the requirements are ambiguous;
   - the change is cross-module or alters a contract with non-obvious blast radius;
   - the work is inherently high-risk or hard to reverse (authentication, transactions,
     concurrency, migrations, security-sensitive design);
   - verification evidence is contested or incomplete.
4. Raise to `deep` only for the hardest subset of the above — a problem that is subtle or
   tightly-coupled enough that `elevated` effort is demonstrably not enough, or a design with
   several strong competing approaches to resolve.
5. `risk`, `scope`, `reversibility`, and `verification` are inputs to this judgement, not automatic
   floors. `scope: cross-module` or `reversibility: hard-to-reverse` are strong signals that
   `elevated` is warranted — weigh them and record the conclusion; they do not by themselves force
   the level.
6. Select the activity profile from [[execution-profile-policy]] whose declared default
   `reasoning_demand` is equal to or below the selected level within the same activity family;
   never select a profile whose default is above the selected level.

The four judgement inputs are structured but not fully objective — reviewers can disagree on where a
dispatch sits. The procedure fixes the default (`routine`) and the order of consideration; every
judgement call is retained in the phase cache even when no free-form rationale is emitted.

## Phase-Boundary Resolution

Apply this procedure through `scripts/execution-profile-router.mjs` on entry to a new phase
boundary. The content-addressed result is cached and normal-path records carry only its compact
profile ID. Within that boundary, re-evaluate only when new structured risk evidence appears or a
higher delegation level is proposed. Routine inline selection needs no repeated free-form
`rationale`; the cache evidence is its explanation. Escalations, exceptions, acknowledged
downgrades, and non-inline delegation still record rationale.

## Delegation Gate

`delegation: inline` is the default. Assign `advisor`, `independent`, or `parallel` **only when at
least one of these holds**, and record which in `rationale`:

1. **Genuinely independent, parallelisable work** — the work divides into two or more workstreams
   with no shared mutable state and no sequential dependency between them, each independently
   verifiable. → `parallel`.
2. **Material second-opinion value** — an isolated judgement from a fresh context measurably raises
   confidence in a specific, consequential decision or a completed diff (for example an
   authorization or data-boundary change). → `advisor` (opinion returns to the primary agent) or
   `independent` (fresh context owns and verifies a separable unit).
3. **Context pollution** — the primary context has accumulated enough unrelated material that a
   fresh, narrowly-scoped context would demonstrably do the specific sub-task better. →
   `independent`.
4. **Unresolved specialised high-risk decision** — a decision needing specific expertise remains
   genuinely unresolved after the primary agent's normal repository investigation. → `advisor`.

### Do NOT delegate because

- multiple files are involved;
- multiple modules are involved;
- the work is "non-trivial", "complex", or `elevated`/`deep`;
- a normal API contract changes;
- TDD requires writing tests;
- accessibility, security, or performance "should be considered";
- a commit or PR needs authoring;
- a reasoning level of `elevated` or `deep` was selected.

None of these, alone or combined, meets the Delegation Gate. Difficulty is handled by
`reasoning_demand`; delegation needs independence or second-opinion value.

### Parallel Delegation Requirements

Assign `delegation: parallel` only when all are true:

1. The work decomposes into two or more genuinely independent workstreams (no shared mutable state
   or sequential dependency).
2. Each workstream is independently verifiable on its own evidence.
3. Running them as coordinated concurrent dispatches produces materially better coverage, speed, or
   independence of judgement than one agent working the same scope sequentially.

If any condition fails, use `advisor` or `independent` for the part that needs a second opinion, and
keep the rest `inline`.

## Escalation Rules

1. A specialist may raise its own dispatch's `reasoning_demand` when newly discovered complexity,
   risk, scope, or reversibility exceeds the assigned level; record `escalated_from` and
   `escalation_reason`.
2. A specialist may propose raising `delegation` (for example hand back for an independent review it
   now believes is warranted); record the reason. It must not silently drop a `delegation` level
   assigned by the dispatching orchestrator.
3. A specialist must not silently continue at the originally assigned `reasoning_demand` once an
   escalation trigger from [[execution-profile-policy]] is met.
4. A specialist must not silently downgrade a `reasoning_demand` or `delegation` assigned by the
   dispatching orchestrator or a prior escalation; a downgrade requires an explicit, recorded
   rationale and re-acknowledgement from the dispatching orchestrator.
5. Raising `reasoning_demand` moves to the next-higher level in the same activity family unless a
   discovered signal clearly calls for `deep` directly.

## No-Silent-Downgrade Rule

Once a dispatch's `execution_profile`, `reasoning_demand`, and `delegation` are assigned and
acknowledged, no participant may reduce them without an explicit, recorded rationale and
re-acknowledgement by the executing specialist. Silent downgrade is a policy violation. This is an
auditability rule, not a workflow gate: it never blocks progress, it only requires the change to be
written down.

## Realization Rule

Selecting the metadata is only part of the contract; the dispatching agent also resolves how it is
*realized* against the active platform mapping:

- **`reasoning_demand` is advisory at every level.** The mapped model tier and thinking budget are
  applied when the host exposes a control, and otherwise recorded as an unbridged gap in
  `rationale`. Selecting `elevated` or `deep` never, by itself, requires a separate agent context.
- **`delegation` decides the context.** `inline` runs in the current agent's context. `advisor`,
  `independent`, and `parallel` are dispatched through the platform's subagent mechanism (the
  `Agent` tool on Claude Code, native sub-tasks on Codex), each subagent's model set from its own
  `reasoning_demand`. `parallel` fans out across the independent workstreams from the Delegation
  Gate.
- A self-escalation that only raises `reasoning_demand` does **not** cross a realization boundary —
  the primary agent continues in-context at higher effort. A self-escalation that raises
  `delegation` is handed back to the dispatching agent for re-dispatch through the subagent
  mechanism.

The realization rule is stated normatively for the orchestrator in `delivery-engineer.agent.md`
and mapped to native controls in the platform mapping documents.

## Best-Available Fallback Rule

When the active platform mapping cannot provide the exact native model/effort for an assigned
`reasoning_demand`, the platform mapping substitutes the nearest available combination, preferring
an equal-or-stronger one. Reasoning level is a resource selection, not part of the correctness
proof: if no equal-or-stronger option is available, continue at the best available level, record the
gap in `rationale`, and add deterministic verification where it is warranted. Model availability
never blocks a workflow. (Detailed fallback handling is owned by the platform mapping documents.)

## Relationship to Existing Fast/High Contract

This policy defines the shared vocabulary. Core workflow and handoff contracts
(`delivery-engineer.agent.md`, `handoff-workflow.md`, `handoff-template.md`, core `AGENTS.md`)
and the stack-pack model-routing policies use the Execution Profile Metadata contract; the legacy
`Reasoning Mode: Fast|High` contract is retained in those documents only as explicitly deprecated
compatibility input for resuming pre-update workflow artifacts.
