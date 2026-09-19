# Kanban App

A Next.js kanban board application with installed agent packs for its delivery workflow:

- `agents-core`: `.github/agents/agents-core`
- `nextjs-stack-pack`: `.github/agents/nextjs-stack-pack`

## Prompt paths

- Core prompts: `.github/agents/agents-core/agent-docs`
- Next.js prompts: `.github/agents/nextjs-stack-pack/agent-docs`
- Platform execution-profile mappings: `.github/agents/platforms/claude-code/execution-profile-mapping.md`, `.github/agents/platforms/codex/execution-profile-mapping.md`

## Trigger examples

Use agent spec: Delivery-Engineer
New Feature

Use agent spec: Delivery-Engineer
Bug Fix

IDE/copilot preamble text may appear before the trigger block; the first valid trigger block is authoritative.

## Working With Agents

This repo uses layered workflow guidance from `agents-core` and `nextjs-stack-pack`, with repo-specific rules in root `AGENTS.md`.

Start here:

- [Delivery Engineer](./.github/agents/agents-core/agents/delivery-engineer.agent.md)
- [Agent Handoff Workflow](./.github/agents/agents-core/agent-docs/workflows/handoff-workflow.md)
- [Handoff Template](./.github/agents/agents-core/agent-docs/templates/handoff-template.md)
- [Workflow Orchestrator Checkpoint Template](./.github/agents/agents-core/agent-docs/templates/checkpoint-template.md)
- [Next.js Feature Workflow Routing](./.github/agents/nextjs-stack-pack/agent-docs/workflows/feature-workflow-routing.md)
- [Next.js Bug Workflow Routing](./.github/agents/nextjs-stack-pack/agent-docs/workflows/bug-workflow-routing.md)
- [Model Routing Policy](./.github/agents/nextjs-stack-pack/agent-docs/routing/model-routing-policy.md)
- [Repo-Level AGENTS](./AGENTS.md)

Workflow defaults:

- `delivery-engineer` is the workflow owner.
- Feature workflow intake requires a leading `New Feature` trigger.
- Bug workflow intake requires a leading `Bug Fix` trigger.
- Triggered feature/bug workflow requests run in fail-closed mode until `.agent-workflows/<workflow_id>/index.md` and the first workflow artifact is persisted.
- In fail-closed mode, the first response reports workflow ownership/routing state rather than direct implementation edits.
- Workflow steps are recorded per the core `handoff-template.md` (Step Record by default).
- Default `Return To Agent` is `delivery-engineer.agent.md` unless explicitly overridden by an incoming handoff.
- One primary context owns the slice; control returns to the workflow-owner role only for `blocked`, `awaiting-approval`, or `ready-for-closeout`.
- Complexity is classified `trivial` vs `non-trivial` and the delivery is sequenced into TDD increments — inline, not a separate agent.
- The `skills/review-change/` correctness lens is required before closeout when frontend code changes; the accessibility, composition, state-ownership, and nextjs-boundary lenses are diff-classified.
- API contract modelling is a plan-time use of the `skills/review-change/` api-contracts lens.
- A blocking review-lens finding routes scoped rework inline, then the applicable lenses re-run.
- Persist workflow artifacts in `.agent-workflows/<workflow_id>/` and delete that folder after workflow status is `closed`.

## Workflow Prompts

You can initiate the Workflow Orchestrator by starting your prompt with:

- Use agent spec: Delivery-Engineer
- .github/agents/agents-core/agent-docs/prompts/delivery-engineer-auto-loop.prompt.md

## Cloudflare deployment

The Cloudflare Worker build is produced by vinext. Configure the connected Worker under
**Settings → Build** with:

- Production branch: `main`
- Build command: `npm run build:vinext`
- Deploy command: `npm run deploy:cloudflare`
- Non-production branch deploy command: `npm run preview:cloudflare`
- Builds for non-production branches: enabled (the `develop` branch is uploaded as a preview version)

Both deploy commands use vinext's generated `dist/server/wrangler.json`. The production command
promotes the `main` build; the non-production command uploads a version without changing production.

Before the first deploy, add `FIREBASE_SERVICE_ACCOUNT_JSON` as an encrypted Worker secret under
**Settings → Variables and Secrets**. Its value must be the complete Firebase service-account JSON
object. Wrangler validates that the secret exists for both production deploys and preview uploads;
do not configure `GOOGLE_APPLICATION_CREDENTIALS`, because a Worker cannot read a local file path.
