# Workflow Artifact Index Template (v1)

Use this template for `.agent-workflows/<workflow_id>/index.md`. Keep it terse — one row per
artifact, one path per row (repo-relative). It is a pointer index, not a log of content. Budget:
**under 150 lines** (see the Artifact budgets table in `handoff-template.md`).

## Workflow Metadata

- **Workflow ID:**
- **Active Owner:** (`delivery-engineer`)
- **Current Artifact ID:**
- **Status:** (`in-progress` | `blocked` | `awaiting-approval` | `ready-to-resume` | `closed`)
- **Source of truth:** (path to the request/plan this workflow delivers)
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
