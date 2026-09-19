# Claude Code Execution Profile Mapping

## Purpose

Maps the shared, provider-neutral vocabulary defined in
`agents-core/agent-docs/routing/execution-profile-policy.md` onto Claude Code's native model and
effort controls, and onto its subagent mechanism. This document is the only place in the repository
where concrete Claude model identifiers are named; core and stack-pack policy stays platform-neutral
per `agents-core/agent-docs/routing/execution-profile-schema.md`.

## Scope Boundary

This mapping activates only when the active VS Code extension / host is Claude Code. The repository
never chooses between Claude Code and Codex; the active tool determines which platform mapping
document applies (see `platforms/codex/execution-profile-mapping.md` for the other).

## Two Independent Axes

`reasoning_demand` and `delegation` are mapped separately:

- **`reasoning_demand`** → a model tier and a thinking budget (advisory at every level).
- **`delegation`** → whether the dispatch runs in the current context or through the `Agent` tool.

Claude Code realizes the reasoning axis with two independent controls:

| Axis | Values | Native control |
| --- | --- | --- |
| Model tier | `light` \| `standard` \| `deep` | The active model, or the `model` parameter on an `Agent`-tool dispatch. |
| Thinking budget | `minimal` \| `standard` \| `extended` \| `maximum` | The session's extended-thinking / effort setting (for example the `/fast` toggle, an effort control, or the default for a dispatched subagent). |

Each `reasoning_demand` level carries a default pairing of the two. A dispatch that needs a
non-default pairing records that in its `rationale`; there is no extra metadata field.

## Model Classes (Capability-Based)

| Model tier | Current model identifier | Typical use |
| --- | --- | --- |
| `light` (Fastest) | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | `lightweight` dispatches: mechanical, deterministic, high-volume work. |
| `standard` (Default capable) | Claude Sonnet 5 (`claude-sonnet-5`) | `routine` dispatches: normal bounded engineering. |
| `deep` (Highest capability) | Claude Opus 4.8 (`claude-opus-4-8`) | `elevated` and `deep` dispatches: non-trivial to hardest reasoning. |
| Narrative/creative variant | Claude Fable 5 (`claude-fable-5`) | Available as an `Agent`-tool `model` override for narrative/creative-leaning specialist work; not part of the default tier ladder. |

Model identifiers are the current lineup as of this writing and are expected to change; treat the
model tier (`light` / `standard` / `deep`) as the stable contract and re-resolve the concrete
identifier against the active Claude Code environment at dispatch time.

## Execution Profile Mapping Table

| Shared `reasoning_demand` | Model tier | Thinking budget | Realization |
| --- | --- | --- | --- |
| `lightweight` | `light` | `minimal` | **Advisory.** Applied if the host exposes a model/effort control, otherwise the gap is recorded in `rationale`. |
| `routine` | `standard` | `standard` | **Advisory.** As above. This is the default. |
| `elevated` | `deep` | `extended` | **Advisory.** As above. Does not by itself require a separate context. |
| `deep` | `deep` | `maximum` | **Advisory.** As above. The hardest reasoning tier; still runs in the current context unless `delegation` says otherwise. |

This table provides complete coverage for every shared `reasoning_demand` level. `reasoning_demand`
is advisory at every level: where the host does not expose manual model/effort selection, record the
gap in `rationale` and proceed — the semantic level is still selected, recorded, and escalated
normally.

## Delegation Mapping

| Shared `delegation` | Native mechanism |
| --- | --- |
| `inline` | No mechanism. The current agent does the work in its own context, applying the advisory model/effort for the dispatch's `reasoning_demand`. |
| `advisor` | One `Agent`-tool dispatch. `model` is set from the subagent's own `reasoning_demand` via the table above. The subagent returns analysis/opinion; the primary agent keeps ownership. |
| `independent` | One `Agent`-tool dispatch that owns and verifies a separable unit of work and returns a verdict/result. `model` set from its `reasoning_demand`. |
| `parallel` | Two or more coordinated `Agent`-tool dispatches for the genuinely independent workstreams identified by the Delegation Gate in `agents-core/agent-docs/routing/reasoning-selection-policy.md`, each with `model` set from its own `reasoning_demand`. |

For `advisor` / `independent` / `parallel`, prefer the most specific matching subagent type over
`general-purpose` when one exists, and pass the specialist `.agent.md` path and the worker prompt
artifact path to the subagent. `.agent-workflows/<workflow_id>/` handoff artifacts carry context
across the subagent boundary.

## Realization Boundary

Raising `reasoning_demand` (even to `deep`) is **not** a context boundary — it only changes the
advisory model/effort for a dispatch that still runs in the primary context. The context boundary is
`delegation`: `inline` stays in-context; `advisor` / `independent` / `parallel` cross into one or
more `Agent`-tool subagents. A self-escalation that only raises `reasoning_demand` continues
in-context; one that raises `delegation` is handed back to `delivery-engineer` for re-dispatch.

## Parallel Delegation Representation

When a dispatch resolves to `delegation: parallel`:
1. The primary agent dispatches independent, coordinated subagents via the `Agent` tool for the
   genuinely independent workstreams identified by the Delegation Gate, each with `model` set from
   its own `reasoning_demand`.
2. `delegation: parallel` is satisfied only when native subagent dispatch is actually used, not by
   operating a single agent at maximum effort.
3. If the active host does not expose `Agent`-tool dispatch at all, do not claim `parallel` was
   realized; fall back to a single in-context pass at the highest applicable `reasoning_demand` and
   record the limitation per Capability Limits below.

## Best-Available Fallback

When the exact model tier or thinking budget for an assigned `reasoning_demand` is unavailable in
the active Claude Code environment (for example, the `deep` tier is not entitled or is rate-limited):
1. Substitute the nearest available model tier or thinking budget, preferring an equal-or-stronger
   one.
2. If only a weaker option is available, continue at the best available level rather than blocking.
3. Record the substitution and its reason in the dispatch's `rationale`, and add deterministic
   verification (extra targeted tests, a type/lint pass) where the reduced effort warrants it.

Reasoning level is a resource selection, not part of the correctness proof — tests, the compiler,
the linter, and human approval boundaries are. Model availability never blocks a workflow.

## Agent/Subagent Configuration Guidance

This repository's specialist agents are distributed as plain `.agent.md` instruction files read
directly by the active session ("Read and execute: `<path>`"), not as pre-registered native
subagent definitions. Apply the mapping as follows:
- For `advisor` / `independent` / `parallel` dispatches, use the `Agent` tool's `subagent_type` and
  `model` parameters: set `model` from the subagent's `reasoning_demand`, prefer the most specific
  matching subagent type, and pass the specialist `.agent.md` path and worker prompt artifact path.
- For `inline` dispatches, communicate the resolved tier/budget as part of the Execution Profile
  Metadata acknowledgement (for example, "Reasoning Demand: elevated → `deep` tier, `extended`
  thinking"), and select the corresponding control manually if the host exposes one.

## Capability Limits (Explicit)

A prompt alone cannot reconfigure the active primary model or effort setting where the host does not
expose that capability. When the active Claude Code environment does not expose manual model/effort
selection:
1. Do not claim a tier/budget was applied if it could not be realized.
2. Record the gap explicitly in the dispatch's `rationale` (for example, "assigned `deep`/`extended`;
   host does not expose effort control, operating at host default").
3. `advisor` / `independent` / `parallel` are realized through `Agent`-tool dispatch, which sets
   `model` directly and does not depend on the host exposing a primary-model control. If `Agent`-tool
   dispatch itself is unavailable, run the work in-context at the highest applicable
   `reasoning_demand`, record the limitation, and add deterministic verification — do not block.
4. This limitation never justifies skipping the Execution Profile Metadata block itself; the
   semantic profile is still selected, recorded, and escalated normally.
