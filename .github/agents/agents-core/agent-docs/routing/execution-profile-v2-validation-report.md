# Execution Profile Routing v2: Validation Report

## Purpose

Records the validation pass over the **execution-profile v2 rework** — collapsing the shared `reasoning_demand` scale from six levels to four and making the top of the scale bind through subagent dispatch. This report supersedes `execution-profile-e2e-validation-report.md` (the Slice 8 end-to-end pass over the six-level architecture); that report is left intact as a dated record of the state it validated.

## A. What changed

### A.1 Six levels → four

| Before (6) | After (4) |
| --- | --- |
| `lightweight` | `lightweight` |
| `routine` | `routine` |
| `complex` + `intensive` + `extreme` | `elevated` |
| `orchestrated` | `orchestrated` |

Every catalogue family folded its `-complex` / `-intensive` / `-extreme` profiles into a single `-elevated` profile (`architecture` collapsed three rows into one; `implementation`, `debugging`, `review`, `verification`, `exploration`, `planning`, `testing` each collapsed to a `-routine` / `-elevated` pair). `delivery` and the `orchestration` family were unchanged.

The Selection Procedure floors collapsed: `risk: high|severe`, `scope: cross-module|system-wide`, `reversibility: hard-to-reverse`, and verification ambiguity now all floor at `elevated` (previously split across `complex`/`intensive`/`extreme`). The procedure was renamed from "deterministic" to "structured classification" — its inputs are structured but not fully objective, and the doc now says so.

### A.2 The scale now binds

The mapping tables gained a **Realization** column and split **model tier** from **thinking budget** as two named axes:

- `lightweight` / `routine` — realized **in-session**; the mapped model tier and thinking budget are **advisory** (applied only where the host exposes a control; any gap is recorded in `rationale`).
- `elevated` / `orchestrated` — realized through the platform's subagent-dispatch mechanism (the `Agent` tool on Claude Code) with `model` set to the mapped `deep` tier — **enforced**. `orchestrated` additionally fans out across the independent workstreams from the Orchestration Justification Test.
- A self-escalation that crosses `routine → elevated` also crosses the realization boundary: the specialist records `escalated_from` / `escalation_reason` and hands back to `workflow-orchestrator` for re-dispatch as a subagent rather than continuing in-session.

`workflow-orchestrator.agent.md` carries the new realization responsibility (Responsibility 34, plus dispatch-loop step 2a and a Decision Rule); the platform mapping documents make it concrete. Claude Code's retired "Ultracode" sixth tier is gone — `orchestrated` is the `elevated` model tier plus `Agent`-tool decomposition, not a stronger model.

### A.3 Files touched

- Core vocabulary: `execution-profile-policy.md`, `execution-profile-schema.md`, `reasoning-selection-policy.md`, `core-agent-execution-profile-defaults.md`, `execution-profile-worked-examples.md`
- Dispatch/contract: `agents/workflow-orchestrator.agent.md`, `AGENTS.md`, `README.md` (agents-core), `templates/handoff-template.md`, `workflows/handoff-workflow.md`
- Platform mappings: `platforms/claude-code/execution-profile-mapping.md`, `platforms/codex/execution-profile-mapping.md`
- Stack packs: `frontend/{react,vue}-stack-pack` and `backend/{node-express,node-express-ts}-stack-pack` `model-routing-policy.md`
- Validator + tests: `scripts/validate-execution-profiles.mjs`, `scripts/validate-execution-profiles.test.mjs`
- Root `README.md`

No production or test code in any repo was changed. `architecture-planner.agent.md` and the other six core agents reference the defaults doc by link only and needed no edit.

## B. Validator changes

Two changes to `scripts/validate-execution-profiles.mjs`:

1. The single hard-coded level count: `reasoningDemandLevels.length !== 6` → `!== 4` (and its diagnostic string). The catalogue-parse, undeclared-profile scan, mapping-completeness, and model-leakage checks all adapt from the parsed level list automatically.
2. A named exclusion (`SUPERSEDED_PROFILE_RECORD_SUFFIX = "-validation-report.md"`) removing point-in-time validation records from the **undeclared-profile scan only**. Those files quote the profile vocabulary as it stood on a given date and are superseded rather than rewritten (Phase 06's "do not edit the Slice 8 report" constraint). They remain subject to the model-leakage scan — a record must still not name a concrete model.

Test fixtures (`validate-execution-profiles.test.mjs`): `VALID_POLICY`, `VALID_CLAUDE_MAPPING`, and `VALID_CODEX_MAPPING` were rewritten to the four-level shape; the two string-replace fixtures were retargeted (`review-complex` → `review-elevated`, the removed Codex row → `elevated`). The `review-extreme` / `delivery-extreme` negative tests are unchanged — they still exercise the undeclared-profile path.

## C. Deterministic validator results

Run from repository root on 2026-09-02:

```
$ node scripts/validate-execution-profiles.mjs
Execution-profile validation passed.

$ node scripts/validate-alias-routing.mjs
Alias routing validation passed.

$ node scripts/validate-skills.mjs
Skill validation passed. (9 manifest skills checked)

$ node --test 'scripts/**/*.test.mjs' 'bootstrappers/**/*.test.mjs'
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

All three repository validators pass. All 16 tests pass (9 execution-profile tests, 7 pre-existing component-layout tests) — none regressed.

Acceptance grep — `grep -rE '\b(complex|intensive|extreme)\b'` over `agents-core`, `frontend`, `backend`, `platforms`, and `README.md`, excluding `*-validation-report.md` records (consistent with the validator's own `SUPERSEDED_PROFILE_RECORD_SUFFIX` exclusion — these two reports quote the old vocabulary as history) — returns only four hits, all ordinary English prose ("over-complex abstractions", "async recovery paths are complex"). No demand-level or `execution_profile` tokens remain in live policy.

## D. Live subagent-realization check

Mirrors Slice 8 §C, but exercises the `elevated` path rather than `lightweight`.

Dispatched a real subagent via the `Agent` tool with `model` set to the `deep` tier — the exact native mechanism the Claude Code mapping assigns to `elevated` and `orchestrated` realization (`platforms/claude-code/execution-profile-mapping.md`, Execution Profile Mapping Table: `elevated` → `deep` tier, "Dispatched through the `Agent` tool with `model` set to the `deep` tier"). Task: read the reworked policy and platform mapping and report their `elevated`-related content verbatim.

**Result:** the dispatch succeeded. The subagent returned:
- the policy H1 (`# Execution Profile Policy`);
- the full four-row "Shared Reasoning-Demand Levels" table, with `elevated` showing `deep` / `extended` / `subagent (enforced)`;
- the realization sentence: *"`elevated` and `orchestrated` are realized through the platform's subagent-dispatch mechanism (the `Agent` tool on Claude Code) with the model set from the active platform mapping."*;
- the `elevated` mapping row: `` | `elevated` | `deep` | `extended` | **Subagent, enforced.** Dispatched through the `Agent` tool with `model` set to the `deep` tier and extended thinking enabled for the subagent. ``

This confirms the enforced-realization mechanism (`Agent`-tool dispatch with the `model` parameter selecting the mapped tier) is real and executable in this host, and that the policy and platform-mapping documents agree on the `elevated` tier contract.

## E. Regression spot-check

- `execution-profile-policy.md` still exposes exactly the two validator-parsed sections (`## Shared Reasoning-Demand Levels`, `## Activity-Specific Execution Profile Catalogue`); the catalogue holds four demand values and no `-complex` / `-intensive` / `-extreme` suffix.
- Core dispatch-metadata markers intact: `grep -n "Execution Profile Metadata"` still hits `workflow-orchestrator.agent.md`, `handoff-workflow.md`, `handoff-template.md`, and core `AGENTS.md` (enforced by the validator's regression check).
- Test-first / evidence gates, review rework loops, commit/push gate, closeout gate, and the PR-never-automatic guardrail: unchanged — this rework touched only reasoning-demand vocabulary and realization, not gate behavior.
- Legacy `Reasoning Mode: Fast|High` compatibility section in `handoff-workflow.md`: left as-is, deprecated-input only.

## F. Downstream consumer sync

**Not performed in this pass.** The four consumer repos (`restore-streetmapper`, `integration-platform-{ui,api,worker}`) vendor a subset of the framework under `.github/agents/`. Syncing the level change to them is Phase 07 of the rework plan and is tracked as a separate mechanical pass:

- `restore-streetmapper` — has `agents-core` + `react-stack-pack` + `platforms`; a clean copy (was byte-identical to upstream).
- `integration-platform-{ui,api,worker}` — have `agents-core` + one stack pack, **no `platforms/`**. They predate the `platforms/` install step; syncing the level change also needs a decision on whether to add `platforms/` now (required for any enforcement) or accept advisory-only until a later reconciliation.

## G. Residual risks and limitations

1. **Codex live validation not performed.** Inherited from Slice 8 §D/§H(1): no Codex execution environment is available. The Codex mapping is covered only by the structural validator (every level has a mapping-table row; no model identifier leaks outside `platforms/`). The `elevated` → `High`–`Extra High` range mapping and the enforced sub-task dispatch are documented but not field-proven on Codex.
2. **Worked examples and dry-run traces are illustrative.** `execution-profile-worked-examples.md` was regenerated against the four levels with per-dispatch realization notes, cross-checked against the real catalogue and defaults, but it is a constructed narrative, not a transcript of a live `.agent-workflows/` run.
3. **Verification-ambiguity floor moved up.** Under the six-level scale, `review-backed` / `multi-specialist-verification` with contested evidence floored at `complex`; it now floors at `elevated` (subagent-enforced). This is the faithful translation of `complex → elevated` but does mean contested-evidence verification now crosses the realization boundary where before it did not.

## H. Recommendation

**Ready to release the upstream (`johnpwise/agents`) change.** All validators and the full test suite pass; the acceptance grep is clean; the enforced-realization mechanism is confirmed live via `Agent`-tool dispatch at the `deep` tier; no gate behavior regressed. Residual items G(1) and G(3) are non-blocking follow-ups. Phase 07 (consumer-repo sync) is a separate pass and is not a precondition for merging the upstream change.
