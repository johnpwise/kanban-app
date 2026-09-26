# Codex Execution Profile Mapping

## Purpose

Maps the shared, provider-neutral vocabulary defined in
`agents-core/agent-docs/routing/execution-profile-policy.md` onto Codex's native model and
reasoning-effort controls, and onto its sub-task mechanism. This document is the only place in the
repository where concrete Codex/GPT model identifiers are named; core and stack-pack policy stays
platform-neutral per `agents-core/agent-docs/routing/execution-profile-schema.md`.

## Scope Boundary

This mapping activates only when the active VS Code extension / host is Codex. The repository never
chooses between Codex and Claude Code; the active tool determines which platform mapping document
applies (see `platforms/claude-code/execution-profile-mapping.md` for the other).

## Two Independent Axes

`reasoning_demand` and `delegation` are mapped separately:

- **`reasoning_demand`** → a model tier and a reasoning-effort setting (advisory at every level).
- **`delegation`** → whether the dispatch runs in the current context or through a native sub-task.

| Axis | Values | Native control |
| --- | --- | --- |
| Model tier | `light` \| `standard` \| `deep` | The coding model selected for the dispatch or agent role. |
| Reasoning effort | `low` \| `medium` \| `high` \| `xhigh` \| `max` | The `reasoning_effort` (or equivalent) setting on the active Codex configuration. |

The exact pairs below are the deterministic routing contract. They follow the current GPT-6 model
and effort surface documented at https://developers.openai.com/api/docs/guides/latest-model and
must be updated here when that platform surface changes.

## Model Classes (Capability-Based)

| Model tier | Current model identifier | Typical use |
| --- | --- | --- |
| `light` (Smallest/fastest) | `gpt-6-luna` | `lightweight` dispatches: mechanical, deterministic, high-volume work. |
| `standard` (Standard coding) | `gpt-6-sol` | `routine` and `elevated` coding/agentic work. |
| `deep` (Highest capability) | `gpt-6-astra` | The hardest `deep` reasoning work. |

These identifiers are a dated platform snapshot, while the semantic demand values and compact
profile IDs remain stable. Update this platform-owned file and its validator together when the
available Codex lineup changes.

## Execution Profile Mapping Table

| Shared `reasoning_demand` | Model tier | Codex model | `reasoning_effort` | Realization |
| --- | --- | --- | --- | --- |
| `lightweight` | `light` | `gpt-6-luna` | `low` | **Advisory.** Applied if the host exposes a control, otherwise the gap is recorded as an exception. |
| `routine` | `standard` | `gpt-6-sol` | `medium` | **Advisory.** As above. This is the default. |
| `elevated` | `standard` | `gpt-6-sol` | `high` | **Advisory.** As above. Does not by itself require a separate context. |
| `deep` | `deep` | `gpt-6-astra` | `max` | **Advisory.** As above. The hardest reasoning tier; still runs in the current context unless `delegation` says otherwise. |

This table provides complete coverage for every shared `reasoning_demand` level. `reasoning_demand`
is advisory at every level: where the host does not expose manual model/effort selection, record the
gap in `rationale` and proceed.

## Delegation Mapping

| Shared `delegation` | Native mechanism |
| --- | --- |
| `inline` | No mechanism. The current agent does the work in its own context, applying the advisory model/effort for the dispatch's `reasoning_demand`. |
| `advisor` | One native sub-task / agent-role dispatch; model/`reasoning_effort` set from the sub-task's own `reasoning_demand`. Returns analysis/opinion; the primary agent keeps ownership. |
| `independent` | One native sub-task that owns and verifies a separable unit of work and returns a verdict/result. |
| `parallel` | Two or more coordinated sub-tasks / agent roles via Codex's native multi-agent coordination, for the genuinely independent workstreams identified by the Delegation Gate, each with model/effort set from its own `reasoning_demand`. |

## Realization Boundary

Raising `reasoning_demand` (even to `deep`) is **not** a context boundary — it only changes the
advisory model/effort. The context boundary is `delegation`: `inline` stays in-context; `advisor` /
`independent` / `parallel` cross into one or more native sub-tasks. A self-escalation that only
raises `reasoning_demand` continues in-context; one that raises `delegation` is handed back to
`delivery-engineer` for re-dispatch.

## Parallel Delegation Representation

When a dispatch resolves to `delegation: parallel`:
1. The primary agent dispatches independent, coordinated sub-tasks via Codex's native multi-agent
   coordination for the genuinely independent workstreams identified by the Delegation Gate, each at
   the model/effort mapped from its own `reasoning_demand`.
2. `delegation: parallel` is satisfied only when native multi-agent coordination is actually used,
   not by operating a single agent at `Ultra` effort.
3. If the active Codex host does not expose native multi-agent coordination, do not claim `parallel`
   was realized; fall back to a single in-context pass at the highest applicable `reasoning_demand`
   and record the limitation per Capability Limits below.

## Best-Available Fallback

When the exact model tier or reasoning-effort setting for an assigned `reasoning_demand` is
unavailable in the active Codex environment:
1. Substitute the nearest available setting, preferring an equal-or-stronger one.
2. If only a weaker option is available, continue at the best available level rather than blocking.
3. Record the substitution and its reason in the dispatch's `rationale`, and add deterministic
   verification where the reduced effort warrants it.

Reasoning level is a resource selection, not part of the correctness proof. Model availability never
blocks a workflow.

## Agent-Role Configuration Guidance

This repository's specialist agents are distributed as plain `.agent.md` instruction files read
directly by the active session ("Read and execute: `<path>`"), the same file format Codex reads via
`AGENTS.md`-style conventions. Skills additionally ship a Codex-specific role descriptor at
`agents/openai.yaml` alongside each skill's `SKILL.md`. Apply the mapping as follows:
- For `advisor` / `independent` / `parallel` dispatches, set the model/`reasoning_effort` fields in
  the agent-role descriptor (or sub-task configuration) from the sub-task's own `reasoning_demand`,
  and prefer the most specific matching role.
- For `inline` dispatches, communicate the resolved tier/effort as part of the Execution Profile
  Metadata acknowledgement (for example, "Reasoning Demand: routine → `standard` tier, `Medium`
  effort"), and select the corresponding control manually if the host exposes one.

## Capability Limits (Explicit)

A prompt alone cannot reconfigure the active primary model or reasoning-effort setting where the
host does not expose that capability. When the active Codex environment does not expose manual
model/effort selection:
1. Do not claim a tier/effort was applied if it could not be realized.
2. Record the gap explicitly in the dispatch's `rationale`.
3. `advisor` / `independent` / `parallel` are realized through native sub-task / agent-role
   dispatch, which sets the model directly. If that mechanism is unavailable, run the work
   in-context at the highest applicable `reasoning_demand`, record the limitation, and add
   deterministic verification — do not block.
4. This limitation never justifies skipping the Execution Profile Metadata block itself; the
   semantic profile is still selected, recorded, and escalated normally.
