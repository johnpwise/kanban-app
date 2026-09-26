# Workflow Artifact Index Template (v1)

Use this template for `.agent-workflows/<workflow_id>/index.md`. Keep it terse — one row per
artifact, one path per row (repo-relative). It is a pointer index, not a log of content. Budget:
**under 150 lines** (see the Artifact budgets table in `handoff-template.md`).

Slice 1 shadow mode keeps this compatibility index and separately derives
`ledger-views/index.md` from `ledger.jsonl`. Do not hand-edit the derived index.

## Workflow Metadata

- **Workflow ID:**
- **Active Owner:** (`delivery-engineer`)
- **Current Artifact ID:**
- **Status:** (`in-progress` | `blocked` | `awaiting-approval` | `ready-to-resume` | `closed`)
- **Canonical slice spec:** (`.agent-workflows/<workflow_id>/slice-spec.json`, slice ID, revision,
  SHA-256 hash; legacy request/plan path only when resuming a pre-Slice 2 workflow)
- **Last Updated (UTC):**

## Latest Prompt by Target Agent

| Target Agent | Artifact ID | Prompt Path (repo-relative) | Updated (UTC) |
| --- | --- | --- | --- |
| `architecture-advisor.agent.md` |  |  |  |

## Latest Return by Source Agent

| Source Agent | Artifact ID | Handoff Path (repo-relative) | Updated (UTC) |
| --- | --- | --- | --- |
| `architecture-advisor.agent.md` |  |  |  |

## Artifact Log (Chronological, newest first)

| Timestamp (UTC) | Type | From → To | Artifact ID | Path (repo-relative) | Status Note |
| --- | --- | --- | --- | --- | --- |
|  | `worker-prompt` | `delivery-engineer` → |  |  |  |

## Cleanup Record

- **Artifact Cleanup Status:** (`pending` | `completed` | `failed`)
- **Cleanup Timestamp (UTC):**
