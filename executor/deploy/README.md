# ADA executor — Cloud Run Job provisioning

Provisions the existing `executor/` container as a Google Cloud Run **Job** and lets you run it
manually, on demand, with a specific `executionRuns/{id}` — independent of automatic triggering.
This establishes and proves the execution *target* only.

**Not included here:** the automatic trigger itself. That lives in `functions/` as a separate
increment — `launchAdaExecutionRun` ([functions/src/index.ts](../../functions/src/index.ts)) is an
Eventarc-backed Cloud Function that fires on every `executionRuns/{id}` document creation and calls
the Cloud Run Admin API to run this Job, the same way `execute` below does. So in practice, any
`executionRuns` document — however it's created — is very likely to launch this Job automatically,
whether or not you ever call `execute` yourself. `execute` remains useful as an explicit, scriptable
path (e.g. for manual/local testing) that doesn't depend on that Function or on writing to
Firestore first. New Execution Run statuses, Firestore writes from the executor, and Card status
changes remain out of scope for this deploy tooling — see the root [`AGENTS.md`](../../AGENTS.md) /
project ADA history for that boundary.

## What this is

- `deploy.sh` — one script, four subcommands, each idempotent (safe to re-run):
  - `setup` — enable required APIs, create the Artifact Registry repo and the runtime service
    account, bind IAM. One-time, but safe to re-run (every step checks-before-creating).
  - `build` — build the image (local Docker if present, otherwise Cloud Build) and push it to
    Artifact Registry, tagged with the current git commit SHA (immutable — never relies on
    `latest`).
  - `deploy-job` — create or update the Cloud Run Job definition to point at the most recently
    built image. **Does not set `ADA_EXECUTION_RUN_ID`** — the Job's persistent definition never
    carries an execution-specific value. Wires `CODEX_API_KEY` from Secret Manager via
    `--set-secrets` — see "Codex CLI authentication" below.
  - `execute <executionRunId>` — run the Job once, supplying `ADA_EXECUTION_RUN_ID` as a
    per-execution override (`--update-env-vars` on `gcloud run jobs execute`). Confirmed live
    (`.agent-workflows/ada-executor-repository-checkout-live-validation/step-009.md`): this
    overrides for that execution only and does not modify the Job resource — the Job's stored
    definition was verified via `gcloud run jobs describe` to be unchanged, still carrying no
    `ADA_DEBUG_UNSAFE_GIT_STDERR`, immediately after an `execute` call that passed it as a
    per-execution override. This is distinct from `gcloud run jobs update --update-env-vars`
    (used by `deploy-job`'s underlying `gcloud run jobs deploy` machinery and by manual
    diagnostics), which **merges** into the Job's existing env vars rather than replacing them —
    also confirmed live in the same step, and the reason `deploy-job` never uses `update` directly.
- `config.env.example` — the configurable values (project, region, Artifact Registry repo, image
  name, Job name, runtime service account). Copy to `config.env` (gitignored) or export the same
  variable names in your shell.

Deliberately **not** wired into `npm run` — these commands touch real GCP state, so they stay one
explicit `bash executor/deploy/deploy.sh <subcommand>` away rather than being reachable by a
routine `npm run` typo.

## Why a plain script, not Terraform

The repository has no existing infrastructure-as-code tooling, and this increment is four
resources (one Artifact Registry repo, one service account, one IAM binding, one Cloud Run Job).
A checked-in script matches the "smallest maintainable mechanism" bar; introducing Terraform for
four resources would be a disproportionate new toolchain. Revisit if/when ADA's infrastructure
footprint grows enough to need drift detection or multi-environment state.

## Resources this creates (on `setup` / `build` / `deploy-job`)

| Resource | Name | Notes |
| --- | --- | --- |
| APIs enabled | `run.googleapis.com`, `artifactregistry.googleapis.com`, `iam.googleapis.com`, `cloudbuild.googleapis.com` | project-level, idempotent |
| Artifact Registry repo | `ada-executor` (docker format) | region: `europe-west2` by default |
| Service account | `ada-executor-runtime@<project>.iam.gserviceaccount.com` | display name "ADA Executor Runtime" |
| IAM binding | `roles/datastore.user` on the above SA, at project scope | Firestore IAM has no finer grain than project. Upgraded from `roles/datastore.viewer` — see "Runtime permission history" below. |
| IAM binding | `roles/artifactregistry.writer` for `<project-number>@cloudbuild.gserviceaccount.com`, scoped to the `ada-executor` repo only (not project-wide) | needed only because local Docker is unavailable in the environment this was built in, so `build` falls back to Cloud Build, which needs write access to push the image |
| Secret Manager secret | `ada-codex-api-key` (configurable via `ADA_CODEX_API_KEY_SECRET`) | created **empty** — `setup` never sets a version; see "Codex CLI authentication" below |
| IAM binding | `roles/secretmanager.secretAccessor` on the above secret, scoped to that one secret only (not project-wide) | granted to the runtime SA so the Job can resolve `CODEX_API_KEY` at container start |
| Cloud Run Job | `ada-executor` | region `europe-west2`, 1 task, `max-retries=0`, runtime SA above, no persistent `ADA_EXECUTION_RUN_ID`, `CODEX_API_KEY` sourced from the Secret Manager secret above via `--set-secrets` |

No other roles are granted to the runtime service account. It cannot call other GCP APIs beyond
Firestore, and has no Cloud Run/IAM/Artifact Registry permissions on itself. Cloud Build's own
default service account is granted nothing beyond write access to this one Artifact Registry
repository — not the broad project Editor role GCP used to grant it automatically.

## Runtime permission history

- **Through the executor-shell increment** (`.agent-workflows/ada-cloud-run-executor-shell`): the
  executor was read-only, so the runtime SA held `roles/datastore.viewer` only.
- **From the atomic-claim increment** (`.agent-workflows/ada-executor-atomic-claim`): the executor
  now performs exactly one conditional Firestore write per run — an atomic transactional claim on
  `executionRuns/{id}` (`claimExecutionRun` in `executor/src/executionRunRepository.ts`) — so the
  runtime SA needs `datastore.entities.get` + `datastore.entities.update` in addition to read.
  `roles/datastore.user` is the smallest **predefined** role that covers this (it also grants
  `create`/`delete`/`allocateIds`/index-list, which this code does not use). A narrower custom role
  scoped to exactly `get`+`update` was considered and explicitly deferred: this repo intentionally
  uses a plain provisioning script instead of an IaC tool for its small resource footprint, and a
  custom IAM role would add a new kind of infra artifact (creation + versioning) disproportionate
  to closing that permission gap. Revisit if the executor's required permission set stays this
  narrow long-term and the extra IAM surface becomes worth tightening.
- Re-running `deploy.sh setup` against a real project applies this upgrade live and requires
  separate, explicit approval each time per the root `AGENTS.md` Firebase/Firestore safety section
  — it has **not** been run as part of this increment. The prior `roles/datastore.viewer` binding
  becomes redundant once `roles/datastore.user` is granted (the latter is a superset); removing the
  now-redundant binding is a separate, explicit cleanup step, not automated by this script.

## Codex CLI authentication

The executor invokes the Codex CLI as its coding-agent provider (`executor/src/codexProviderConfig.ts`
+ `executor/src/processCodingAgentRuntime.ts`), authenticated via the `CODEX_API_KEY` env var — the
official mechanism for a non-interactive Codex process (as opposed to `codex login`, which persists
credentials to disk and is wrong for a one-shot Cloud Run Job container).

- **`setup` creates the Secret Manager secret container only, with no version.** This script never
  reads, generates, or holds the real API key value, and it is never written to this repo, to
  `config.env`, to Firestore, or to any execution request.
- **Adding the real value is a separate, manual, one-time step you run yourself**, piping the value
  in so it never touches shell history or the process list:
  ```sh
  printf '%s' "$YOUR_CODEX_API_KEY" | gcloud secrets versions add ada-codex-api-key \
    --project=kanban-app-fa4b7 --data-file=-
  ```
- **`deploy-job` wires it at container start**, not at build time, via
  `--set-secrets="CODEX_API_KEY=ada-codex-api-key:latest"` — Cloud Run resolves the secret's latest
  version into the env var when the container starts; the value is never baked into the image and
  never appears in the Job's own plain env-var configuration (`gcloud run jobs describe` shows the
  secret reference, not the value).
- **Never print, persist, echo, or expose `CODEX_API_KEY`** during tests, deployment, diagnostics,
  or validation. `codexProviderConfig.ts` builds a minimal explicit child-process env
  (`CODEX_API_KEY`, `PATH`, `HOME`) rather than passing through the executor's full environment, so
  the sandboxed Codex process run against a materialised, attacker-influenced repository cannot
  read any other secret the executor might hold.
- Rotating the key: add a new secret version (`gcloud secrets versions add`); Cloud Run resolves
  `:latest` on each new container start, so no `deploy-job` re-run is required. The previous version
  remains readable until explicitly destroyed — see `gcloud secrets versions destroy` if rotation
  requires revoking the old value.

## Region

`europe-west2`, matching this project's existing Firestore location (confirmed via
`firestore_get_database` at the time this was written). Change only if later inspection shows this
is invalid for Cloud Run Jobs in this project.

## Auth model

- **Deploy-time** (`setup` / `build` / `deploy-job` / `execute`): your own `gcloud auth login`
  session. No service-account key is stored in this repo.
- **Runtime** (inside the Job): Application Default Credentials resolved automatically by the
  Cloud Run platform from the Job's assigned runtime service account — the executor code already
  does this today (`executor/src/executionRunRepository.ts`); nothing here changes that.

## Manual execution / smoke test

```sh
bash executor/deploy/deploy.sh execute <accepted-execution-run-id>
```

Use an existing `executionRuns/{id}` document with `status: "accepted"`. If none exists, that is a
separate explicit approval decision (creating a Firestore fixture) — this script does not create
one for you.

After running, verify (see root request / workflow artifact for the full checklist):

- the execution completed successfully (`gcloud run jobs executions describe <execution-name>
  --region=europe-west2`)
- Cloud Logging for that execution contains only `executionRequestId` / `correlationId` /
  `projectId` / `cardId` — no prompt, no full document body, no credentials

**Expected write** (first executor to run against a given `executionRuns/{id}`): exactly one
conditional/transactional update adding a `claim: { claimId, claimedAt }` field
(`claimExecutionRun` in `executor/src/executionRunRepository.ts`), where `claimedAt` is a
server-derived timestamp. No other field on the document changes.

**Must remain unchanged** (always, on every run): the document's `input` (the original execution
request payload), its execution identity fields (`executionRequestId`, `correlationId`,
`projectId`, `cardId`), the related Project, and the related Card other than its pre-existing
`queued` transition (which happens earlier, before the executor runs). No other Firestore document
is written.

**Duplicate executor** (any run after the first has already claimed the document): the
transactional claim read finds the existing `claim` field, returns `{claimed: false}` without
writing, and the executor logs "Execution run already claimed by another executor; exiting
safely" with the same safe identifiers, then exits successfully. The existing claim is left
untouched.

## Prerequisites this script does not install for you

- `gcloud`, authenticated (`gcloud auth login`) with access to the target project
- Either Docker, or `gcloud builds submit` (Cloud Build) access, to build the image
- Billing enabled on the target project (already true for `kanban-app-fa4b7`)
- A real Codex API key, added manually as a Secret Manager secret version — see "Codex CLI
  authentication" above; `setup` does not create or require this to complete successfully, but
  `execute` will fail without it once the Job actually reaches the coding-agent invocation step
