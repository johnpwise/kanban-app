# ADA executor — Cloud Run Job provisioning

Provisions the existing `executor/` container as a Google Cloud Run **Job** and lets you run it
once, manually, with a specific `executionRuns/{id}`. This establishes and proves the execution
*target* only.

**Not included here, and not to be added here without a separate increment:** anything that
triggers the Job automatically (the Pub/Sub consumer, a Function, a scheduler), new Execution Run
statuses, Firestore writes from the executor, or Card status changes. See the root
[`AGENTS.md`](../../AGENTS.md) / project ADA history for that boundary.

## What this is

- `deploy.sh` — one script, four subcommands, each idempotent (safe to re-run):
  - `setup` — enable required APIs, create the Artifact Registry repo and the runtime service
    account, bind IAM. One-time, but safe to re-run (every step checks-before-creating).
  - `build` — build the image (local Docker if present, otherwise Cloud Build) and push it to
    Artifact Registry, tagged with the current git commit SHA (immutable — never relies on
    `latest`).
  - `deploy-job` — create or update the Cloud Run Job definition to point at the most recently
    built image. **Does not set `ADA_EXECUTION_RUN_ID`** — the Job's persistent definition never
    carries an execution-specific value.
  - `execute <executionRunId>` — run the Job once, supplying `ADA_EXECUTION_RUN_ID` as a
    per-execution override (`--update-env-vars` on `gcloud run jobs execute`, which — per current
    Cloud Run docs — overrides for that execution only and does not modify the Job resource;
    **verify this against your installed `gcloud run jobs execute --help`** before relying on it,
    since it wasn't possible to confirm against a live `gcloud` install while writing this).
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
| Cloud Run Job | `ada-executor` | region `europe-west2`, 1 task, `max-retries=0`, runtime SA above, no persistent `ADA_EXECUTION_RUN_ID` |

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
- the `executionRuns/{id}` document and the related Card are byte-for-byte unchanged
- no other Firestore documents were written

## Prerequisites this script does not install for you

- `gcloud`, authenticated (`gcloud auth login`) with access to the target project
- Either Docker, or `gcloud builds submit` (Cloud Build) access, to build the image
- Billing enabled on the target project (already true for `kanban-app-fa4b7`)
