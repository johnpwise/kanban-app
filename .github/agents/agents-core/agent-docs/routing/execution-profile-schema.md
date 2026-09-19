# Execution Profile Schema

## Purpose

Defines the platform-neutral metadata schema every specialist dispatch and handoff must carry to
describe execution profile, reasoning demand, delegation, risk, scope, reversibility, and
verification, independent of any specific AI platform.

This schema is normative for [[execution-profile-policy]] (profile catalogue) and
[[reasoning-selection-policy]] (selection/escalation rules). Concrete model names and
platform-specific effort labels must never appear in this document or in any core/shared policy that
depends on it.

## Two Independent Axes

`reasoning_demand` (how much model capability and thinking budget) and `delegation` (whether the
work runs in a separate agent context) are chosen **separately**. Neither is derived from the other:
a hard, tightly-coupled problem is usually `elevated`/`deep` **and** `delegation: inline`, because a
fresh context would lose what the primary agent has already learned. See
[[execution-profile-policy]] and the Delegation Gate in [[reasoning-selection-policy]].

## Execution Profile Metadata Block

Every dispatch and handoff must carry one Execution Profile Metadata block with these fields:

| Field | Required | Allowed values | Meaning |
| --- | --- | --- | --- |
| `execution_profile` | Yes | one catalogued profile name from [[execution-profile-policy]] | the named activity-specific profile assigned to this dispatch |
| `capability` | Yes | `analysis` \| `synthesis` \| `code-generation` \| `verification` \| `coordination` | the class of work the assigned specialist must perform |
| `reasoning_demand` | Yes | `lightweight` \| `routine` \| `elevated` \| `deep` | the shared semantic reasoning-effort level |
| `delegation` | Yes | `inline` \| `advisor` \| `independent` \| `parallel` | whether this dispatch runs in the current agent's context or as one/more separate agent contexts |
| `risk` | Yes | `low` \| `moderate` \| `high` \| `severe` | consequence of an undetected mistake in this dispatch |
| `scope` | Yes | `local` \| `module` \| `cross-module` \| `system-wide` | breadth of code/system affected |
| `reversibility` | Yes | `easily-reversible` \| `reversible-with-effort` \| `hard-to-reverse` | cost of undoing this dispatch's output if wrong |
| `verification` | Yes | `deterministic-check` \| `test-backed` \| `review-backed` \| `multi-specialist-verification` | how correctness will be established |
| `rationale` | Yes | one-line free text | why this profile / demand / delegation was selected |
| `escalated_from` | Only when escalated | a prior `execution_profile` name | the profile this dispatch was escalated from |
| `escalation_reason` | Only when escalated | one-line free text | the newly discovered complexity or risk that justified escalation |

`risk`, `scope`, `reversibility`, and `verification` are **judgement inputs** recorded for
transparency and audit. They inform, but do not mechanically determine, `reasoning_demand` or
`delegation` — the Selection Procedure and Delegation Gate in [[reasoning-selection-policy]] apply
judgement to them and record it in `rationale`.

### Model Tier and Thinking Budget (Not Metadata Fields)

Each `reasoning_demand` level names a **model tier** and a **thinking budget** as separate sub-axes,
resolved to native controls by the active platform mapping document (see [[execution-profile-policy]]
for the level table). The mapped tier/budget is **advisory at every level**: applied when the host
exposes a control, otherwise recorded as an unbridged gap in `rationale`. A dispatch that wants a
non-default pairing (for example a deep model with a quick thinking budget) states it in `rationale`.
The Execution Profile Metadata block stays the size defined above.

### Delegation Realization (Not A Metadata Field)

`delegation: inline` runs in the current context and needs no platform mechanism. `advisor`,
`independent`, and `parallel` are realized through the platform's subagent mechanism (the `Agent`
tool on Claude Code, native sub-tasks on Codex); each subagent's model is set from its own
`reasoning_demand`. See the Realization Rule in [[reasoning-selection-policy]] and the platform
mapping documents.

### Field Relationships (Required)

1. `reasoning_demand` and `delegation` are independent; any pairing of the two is valid.
2. `delegation: parallel` requires two or more genuinely independent workstreams named in
   `rationale`, each independently verifiable (per the Delegation Gate in
   [[reasoning-selection-policy]]).
3. An `orchestration-*` `execution_profile` requires `delegation: parallel`; `delegation: parallel`
   does not require an `orchestration-*` profile (a single activity family fanned out is also valid).
4. `execution_profile` must resolve to a catalogued profile in [[execution-profile-policy]] whose
   declared default `reasoning_demand` is equal to, or escalated above, the dispatch's
   `reasoning_demand` per [[reasoning-selection-policy]].
5. `escalated_from` and `escalation_reason` must both be present or both be absent.

## Example Dispatch Metadata (Normative)

Baseline example:

```
Execution Profile: implementation-routine
Capability: code-generation
Reasoning Demand: routine
Delegation: inline
Risk: moderate
Scope: module
Reversibility: reversible-with-effort
Verification: test-backed
Rationale: bounded endpoint addition following an established pattern in this module.
```

Hard-but-sequential example (high reasoning, no delegation):

```
Execution Profile: debugging-elevated
Capability: analysis
Reasoning Demand: deep
Delegation: inline
Risk: high
Scope: cross-module
Reversibility: hard-to-reverse
Verification: test-backed
Rationale: intermittent failure traced into a shared transaction boundary; tightly coupled to state the primary agent has already reconstructed, so kept in-context at maximum thinking rather than delegated.
Escalated From: debugging-elevated
Escalation Reason: root cause found in shared transaction handling; reasoning effort raised from elevated to deep, delegation unchanged.
```

Independent-review example (routine reasoning, delegated for a second opinion):

```
Execution Profile: review-elevated
Capability: verification
Reasoning Demand: elevated
Delegation: independent
Risk: high
Scope: module
Reversibility: reversible-with-effort
Verification: review-backed
Rationale: authorization-boundary change; an isolated review of the completed diff by a fresh context materially raises confidence.
```

Parallel example:

```
Execution Profile: orchestration-multi-specialist-review
Capability: coordination
Reasoning Demand: elevated
Delegation: parallel
Risk: high
Scope: system-wide
Reversibility: reversible-with-effort
Verification: multi-specialist-verification
Rationale: security, accessibility, and performance review disciplines apply independently to the same delivered work and are each separately verifiable.
```

## Platform-Neutrality Rule

This schema, and every document that depends on it, must describe reasoning demand and delegation
only in the semantic vocabulary above. Concrete model names and platform-specific effort labels
belong exclusively in the platform-specific mapping documents
(`platforms/claude-code/execution-profile-mapping.md` and
`platforms/codex/execution-profile-mapping.md`).
