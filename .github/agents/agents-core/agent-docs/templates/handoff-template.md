# Handoff / Step Record Template

> Compatibility note: documents that still say "**Template-Based Handoff**" or "**Worker Prompt
> Package**" mean the **Cross-Context Handoff Package** below when a separate agent context is
> involved, and otherwise the **Step Record**. Same-context steps never need the full package.

There are two shapes. Use the smallest one that fits.

1. **Step Record** — the default. A short delta note for a step that runs in the **same context**
   (the primary agent moving from one activity to the next, or recording a checkpoint). Target:
   under ~40 lines.
2. **Cross-Context Handoff Package** — only when the work is actually dispatched to a **separate
   agent context** (`delegation: advisor` / `independent` / `parallel`, or a fresh resume window).
   Carries enough for a cold context to pick the work up.

## The delta-only invariant (both shapes)

**Do not restate information that is already available through a stable referenced source.** The
original request, acceptance criteria, plan, and test matrix live in their source documents — link
to them by path (and heading anchor where useful), do not copy them. Record only: what changed,
what was decided, the evidence, blockers, and the next action. A record that reproduces its inputs
is wrong even if every fact in it is correct.

## Artifact budgets

Every workflow artifact has a ceiling. Exceeding one is allowed only with a one-line recorded reason
in the artifact itself (`Budget note: <why this needs more>`).

| Artifact | Ceiling |
| --- | --- |
| Initial plan | 600–1,000 words |
| Advisor (`delegation: advisor`) result | 500 words |
| TDD checkpoint (GREEN increment) | 100–250 words |
| Independent review (`delegation: independent`) | 600 words |
| Blocker checkpoint | 300 words |
| Closeout summary | 500 words |
| Workflow state / index (`index.md`) | < 150 lines |
| Step Record | ~40 lines |
| Cross-Context Handoff Package | ~120 lines |

If an artifact keeps pushing its ceiling, the missing structure belongs in the source-of-truth
plan, not in the artifact.

---

## Step Record (default)

```
Workflow: <workflow_id>
Source of truth: <path-to-request-or-plan>[#heading]
Step: <what just happened> → next: <what happens next>
Status: in-progress | blocked | awaiting-approval | ready-for-closeout

Execution Profile Metadata: <execution_profile> | reasoning_demand=<...> | delegation=<...>
  (risk/scope/reversibility/verification and rationale in one line; escalated_from/escalation_reason if any)

TDD state: red | green | refactor | n/a
  last command: <command>
  result: <expected-failure | pass | fail — one line>

Changed: <files / areas, bullets>
Decisions: <only new decisions this step, bullets>
Blockers: <none | bullets>
Next action: <one line; and next_agent_alias / workflow_status / reentry_reason if routing>
```

Notes:
- No acknowledgement ritual, no dual absolute+relative paths, no re-pasted acceptance criteria or
  `test_layer_matrix` — those are read from the source of truth.
- `Execution Profile Metadata` stays one block; see
  `agent-docs/routing/execution-profile-schema.md` for field meanings. The marker string
  "Execution Profile Metadata" must be present.
- A Step Record is also the checkpoint shape — see `checkpoint-template.md`.

---

## Cross-Context Handoff Package (only for a separate agent context)

Required first line (subagent dispatch / fresh window only):

`Use agent spec: <Agent-Spec-Alias>`  — alias from `agent-docs/routing/agent-spec-alias-map.md`,
never a path form.

### Header

- **From / To Agent:**
- **Task Type:** (feature | bug | refactor | review | research)
- **Workflow ID:** and **Source of truth:** (path[#heading] — not a copy)
- **Completion Status:** (`ready-for-next-agent` | `needs-changes` | `approval-required` | `blocked`)

### Execution Profile Metadata (Required)

Per `agent-docs/routing/execution-profile-schema.md`:

- **Execution Profile:** (catalogued profile name)
- **Capability:** (`analysis` | `synthesis` | `code-generation` | `verification` | `coordination`)
- **Reasoning Demand:** (`lightweight` | `routine` | `elevated` | `deep`)
- **Delegation:** (`inline` | `advisor` | `independent` | `parallel`)
- **Risk / Scope / Reversibility / Verification:** (one line)
- **Rationale:** (one line covering the reasoning-demand and delegation choice)
- **Escalated From / Escalation Reason:** (only if escalated)

`Reasoning Demand` and `Delegation` are independent — any pairing is valid. `Delegation: parallel`
names two or more independent workstreams in `Rationale`; an `orchestration-*` profile requires
`Delegation: parallel`. The subagent acknowledges `Active Agent` + `Execution Profile` +
`Reasoning Demand` + `Delegation` before starting.

### Pass (what the separate context needs)

- **In scope now / deferred:**
- **Files / areas likely involved:**
- **Source-of-truth pointers:** acceptance criteria, plan, and `test_layer_matrix` **by path +
  heading** — do not paste them
- **Test evidence contract:** `capability_owners` keys in play, `required_preimplementation_tests`,
  `preimplementation_failing_test_evidence`, `e2e_status` — current values only, one line each
- **Work completed / decisions / assumptions:** deltas only
- **Evidence:** commands run and their results
- **Risks / open questions / blockers:**

### Expect / Return Contract

- **Expect:** exactly what output or decision is required back.
- **Return To Agent:** (`delivery-engineer.agent.md` by default unless the incoming handoff
  overrides it)
- **Required return payload:** completed-work summary, validation/command status, blockers,
  recommended next agent, routing metadata (`next_agent_alias`, `workflow_status`,
  `reentry_reason`).

### Completion Signal

What must be true for this handoff to be considered resolved.
