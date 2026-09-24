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

**Automatic launches also supply `CODEX_MODEL` and, when configured, `CODEX_REASONING_EFFORT`** as
the same kind of per-execution `containerOverrides` this file's `execute` uses — never a stored
Job-definition value. The automatic launcher (`functions/src/adaExecutorJobLauncher.ts`) reads and
validates them from two Firebase Functions params, `ADA_CODEX_MODEL` and `ADA_CODEX_REASONING_EFFORT`
(`functions/src/adaExecutorRunLauncherConfig.ts`, alongside the existing `ADA_GCP_PROJECT_ID` /
`ADA_GCP_REGION` / `ADA_JOB_NAME` params), against the same currently-approved allow-lists as
`ALLOWED_CODEX_MODELS` / `ALLOWED_CODEX_REASONING_EFFORTS` below
(`functions/src/adaCodexModelPolicy.ts` — kept as a small explicit duplicate of this script's arrays,
not a shared package). `ADA_CODEX_MODEL` has no default: an unset or unapproved value fails the
launch closed (classified `invalid-configuration`, acknowledged, not retried) rather than launching
the Job without a model. Setting a real value for `ADA_CODEX_MODEL` (and optionally
`ADA_CODEX_REASONING_EFFORT`) in the Functions deploy environment — and redeploying
`launchAdaExecutionRun` — is a separate, explicit operational step this script does not perform.

## What this is

- `deploy.sh` — one script, five subcommands, each idempotent (safe to re-run):
  - `setup` — enable required APIs, create the Artifact Registry repo and the runtime service
    account, bind IAM. One-time, but safe to re-run (every step checks-before-creating).
  - `build` — build the image (local Docker if present, otherwise Cloud Build) and push it to
    Artifact Registry, tagged with the current git commit SHA (immutable — never relies on
    `latest`).
  - `deploy-job` — create or update the Cloud Run Job definition to point at the most recently
    built image. **Does not set `ADA_EXECUTION_RUN_ID`, `CODEX_MODEL`, or
    `CODEX_REASONING_EFFORT`** — the Job's persistent definition never carries an
    execution-specific value; those are supplied per execution instead (see `execute` below).
    Wires `CODEX_API_KEY` and `ADA_GITHUB_APP_PRIVATE_KEY` from Secret Manager via
    `--set-secrets` — see "Codex CLI authentication" and "GitHub App delivery credential" below.
    Also sets the non-secret `ADA_GITHUB_APP_ID` / `ADA_GITHUB_APP_INSTALLATION_ID` env vars when
    configured.
  - `deploy-ci-controller-job` — create or update a **separate** Cloud Run Job (`ada-ci-controller`
    by default, `ADA_CI_JOB_NAME`) that runs the same image as `deploy-job`, overridden via
    `--command=node --args=lib/ciControllerMain.js` to run the CI-controller entry point instead of
    the image's default `lib/main.js`. This is the asynchronous stage that observes GitHub Actions
    for an already-delivered commit and durably records `ci_succeeded`/`ci_failed` (see
    `executor/src/ciControllerMain.ts` and `executor/src/deliveryCiController.ts`); it never invokes
    Codex, so no `CODEX_API_KEY` secret is wired. Reuses the same runtime service account and the
    same `ADA_GITHUB_APP_PRIVATE_KEY` secret as `deploy-job` — no new secret or runtime-SA IAM
    binding is required for the Job's own execution identity. Sets `--task-timeout=1800s` (30
    minutes), sized against `ciControllerMain.ts`'s bounded observation policy — see that file's own
    comment for the exact rationale. Like `deploy-job`, never sets `ADA_EXECUTION_RUN_ID` on the
    Job's persistent definition; it is supplied per execution by the Functions launcher
    (`functions/src/adaCiControllerJobLauncher.ts`). **Provisioning this Job, and granting the
    `ada-launcher-runtime` Function identity `roles/run.jobsExecutorWithOverrides` on it, are live
    GCP mutations gated behind explicit approval — not performed by writing this script.**
  - `execute <executionRunId> <codexModel> [reasoningEffort]` — run the Job once, supplying
    `ADA_EXECUTION_RUN_ID`, `CODEX_MODEL`, and (if given) `CODEX_REASONING_EFFORT` as a
    per-execution override (`--update-env-vars` on `gcloud run jobs execute`). `codexModel` must be
    one of `deploy.sh`'s `ALLOWED_CODEX_MODELS` (currently `gpt-5_6-luna`, `gpt-5_6-terra`);
    `reasoningEffort`, if given, must be one of `ALLOWED_CODEX_REASONING_EFFORTS` (currently `low`,
    `medium`, `high` — a deliberately narrower, currently-approved subset of the full
    `low|medium|high|xhigh|max` the executor's own `CODEX_REASONING_EFFORT` schema accepts; extend
    both arrays together when a new model or effort level is approved). `CODEX_MODEL` is required
    by `executor/src/codexProviderConfig.ts` — omitting it fails the argument check before any
    `gcloud` call is made. Confirmed live
    (`.agent-workflows/ada-executor-repository-checkout-live-validation/step-009.md`): a
    per-execution override overrides for that execution only and does not modify the Job resource —
    the Job's stored definition was verified via `gcloud run jobs describe` to be unchanged, still
    carrying no `ADA_DEBUG_UNSAFE_GIT_STDERR`, immediately after an `execute` call that passed it as
    a per-execution override. This is distinct from `gcloud run jobs update --update-env-vars`
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

## Resources this creates (on `setup` / `build` / `deploy-job` / `deploy-ci-controller-job`)

| Resource | Name | Notes |
| --- | --- | --- |
| APIs enabled | `run.googleapis.com`, `artifactregistry.googleapis.com`, `iam.googleapis.com`, `cloudbuild.googleapis.com` | project-level, idempotent |
| Artifact Registry repo | `ada-executor` (docker format) | region: `europe-west2` by default |
| Service account | `ada-executor-runtime@<project>.iam.gserviceaccount.com` | display name "ADA Executor Runtime" |
| IAM binding | `roles/datastore.user` on the above SA, at project scope | Firestore IAM has no finer grain than project. Upgraded from `roles/datastore.viewer` — see "Runtime permission history" below. |
| IAM binding | `roles/artifactregistry.writer` for `<project-number>@cloudbuild.gserviceaccount.com`, scoped to the `ada-executor` repo only (not project-wide) | needed only because local Docker is unavailable in the environment this was built in, so `build` falls back to Cloud Build, which needs write access to push the image |
| Secret Manager secret | `ada-codex-api-key` (configurable via `ADA_CODEX_API_KEY_SECRET`) | created **empty** — `setup` never sets a version; see "Codex CLI authentication" below |
| IAM binding | `roles/secretmanager.secretAccessor` on the above secret, scoped to that one secret only (not project-wide) | granted to the runtime SA so the Job can resolve `CODEX_API_KEY` at container start |
| Secret Manager secret | `ada-github-app-private-key` (configurable via `ADA_GITHUB_APP_PRIVATE_KEY_SECRET`) | created **empty** — `setup` never sets a version; see "GitHub App delivery credential" below |
| IAM binding | `roles/secretmanager.secretAccessor` on the above secret, scoped to that one secret only (not project-wide) | granted to the runtime SA so the Job can resolve `ADA_GITHUB_APP_PRIVATE_KEY` at container start |
| Cloud Run Job | `ada-executor` | region `europe-west2`, 1 task, `max-retries=0`, runtime SA above, no persistent `ADA_EXECUTION_RUN_ID`, `CODEX_API_KEY` and `ADA_GITHUB_APP_PRIVATE_KEY` sourced from their Secret Manager secrets via `--set-secrets`, `ADA_GITHUB_APP_ID`/`ADA_GITHUB_APP_INSTALLATION_ID` set as plain env vars only once configured |
| Cloud Run Job | `ada-ci-controller` (configurable via `ADA_CI_JOB_NAME`), created only by `deploy-ci-controller-job` | region `europe-west2`, 1 task, `max-retries=0`, `--task-timeout=1800s`, **same** runtime SA as `ada-executor` (no new SA), command overridden to `node lib/ciControllerMain.js`, only `ADA_GITHUB_APP_PRIVATE_KEY` sourced via `--set-secrets` (no `CODEX_API_KEY`), no persistent `ADA_EXECUTION_RUN_ID` |

Not yet created by this script, and gated behind a separate explicit approval: an IAM binding
granting the `ada-launcher-runtime` Function identity `roles/run.jobsExecutorWithOverrides` on the
`ada-ci-controller` Job specifically (Cloud Run Job IAM bindings are per-resource, so the existing
binding on `ada-executor` does not cover it) — see
`.agent-workflows/ci-controller-lifecycle-handoff/plan.md`'s approval boundaries.

No other roles are granted to the runtime service account. It cannot call other GCP APIs beyond
Firestore, and has no Cloud Run/IAM/Artifact Registry permissions on itself. Cloud Build's own
default service account is granted nothing beyond write access to this one Artifact Registry
repository — not the broad project Editor role GCP used to grant it automatically.

## Firestore-trigger Cloud Functions need their own `run.invoker` binding

Not related to this script, but discovered live while validating `launchAdaDeliveryCiControl`
(`functions/src/index.ts`), so recorded here since it will recur for any future 2nd-gen
Eventarc/Firestore-triggered Cloud Function in this project: `firebase deploy` does **not**
automatically grant the trigger's own service account `roles/run.invoker` on the Function's
underlying Cloud Run service. Without it, Eventarc's delivery attempts fail closed with `The
request was not authenticated ... IAM principal lacks {run.routes.invoke} permission`, visible only
in the Cloud Run service's own request logs (`gcloud functions logs read <fn> --gen2` surfaces
these as `WARNING` lines) — the function's own code never runs, so its own logging never appears
either. `launchAdaExecutionRun` already carried this binding (granted manually at some undocumented
earlier point); `launchAdaDeliveryCiControl` did not, and needed it granted explicitly:

```sh
gcloud run services add-iam-policy-binding <function-name-lowercased> \
  --region=europe-west2 --project=kanban-app-fa4b7 \
  --member=serviceAccount:ada-launcher-runtime@kanban-app-fa4b7.iam.gserviceaccount.com \
  --role=roles/run.invoker
```

Check for this after deploying any new Firestore-triggered function:
`gcloud run services get-iam-policy <function-name-lowercased> --region=europe-west2` — an empty
policy means it's missing.

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

## GitHub App delivery credential

ADA publishes the verified local delivery commit to `refs/heads/ada/<executionRequestId>` on
GitHub using a **GitHub App installation access token** — short-lived (~1 hour), minted by the
executor itself from the App's private key, scoped only to the repositories the App is installed
on (`executor/src/githubAppCredential.ts`). This credential is isolated from the Codex coding-agent
process — see `codexProviderConfig.ts`'s explicit child-process env, which never includes any
`ADA_GITHUB_APP_*` variable.

**This requires one manual, external, one-time setup step this script cannot perform for you —
call it out explicitly before relying on the durable-push feature:**

1. **Create a GitHub App** on `https://github.com/settings/apps/new` (or your org's equivalent),
   scoped to the narrowest permissions this feature needs: Repository permissions →
   **Contents: Read and write**, plus **Pull requests: Read and write** (required for ADA to
   create/reuse the delivery Pull Request after a verified push — see "Automatic Pull Request
   creation" below; **not yet granted on the live App as of this writing**, since granting it is a
   separate, explicit operational step, not something this codebase change performs). No other
   repository or account permissions are required. Disable webhooks (not used).
2. **Install the App** on exactly the `johnpwise/kanban-app` repository (not "all repositories").
   Note the **App ID** (shown on the App's settings page) and the **Installation ID** (the numeric
   ID in the URL after installing, e.g. `https://github.com/settings/installations/<id>`).
3. **Generate a private key** for the App (same settings page → "Generate a private key") — this
   downloads a `.pem` file. Treat it exactly like the Codex API key: never commit it, never print
   it, never paste it into a task/execution document.
4. **Add the private key to Secret Manager** (the secret container is created empty by `setup`;
   this step adds the real value, piped in so it never touches shell history or the process list):
   ```sh
   gcloud secrets versions add ada-github-app-private-key \
     --project=kanban-app-fa4b7 --data-file=/path/to/downloaded-key.pem
   ```
5. **Set the two non-secret identifiers** in your `config.env` (or exported environment) before the
   next `deploy-job`:
   ```sh
   ADA_GITHUB_APP_ID=<app id from step 2>
   ADA_GITHUB_APP_INSTALLATION_ID=<installation id from step 2>
   ```
   Then re-run `bash executor/deploy/deploy.sh deploy-job` to apply them to the Job.

**IAM/external-permission call-out:** this grants a new GitHub App **write** access
(Contents: Read and write, plus Pull requests: Read and write for PR creation — see below) to
`johnpwise/kanban-app` — the first GitHub write credential this executor has ever held. It is
repository-scoped (this one repo only) and limited to these two permissions (no Administration,
Actions, or other permission). No GCP IAM role changes are required beyond the same per-secret
`roles/secretmanager.secretAccessor` pattern already used for `CODEX_API_KEY`.

### Automatic Pull Request creation

Once remote delivery is verified, ADA creates (or idempotently reuses) a GitHub Pull Request from
the verified delivery branch into the immutable requested base branch
(`executor/src/adaPullRequest.ts`), using the same installation token minted for the push above —
no second credential or auth path. This call requires the App to additionally hold
**Pull requests: Read and write**; **Contents: Read and write alone is not sufficient** for
`POST /repos/{owner}/{repo}/pulls`.

**As of this writing, the live GitHub App has not been granted this permission** — granting it,
and validating live PR creation, is a deliberate, separate operational step (see
`.agent-workflows/ada-github-pr-creation/` for the slice that introduced this capability). Until
that permission is granted, `createOrReuseAdaPullRequest` fails safely with a typed
`credential_unavailable` / `create_failed` outcome (`pullRequest.status: "failed"`); the already
durably published, independently verified delivery branch and commit remain valid and unaffected —
PR-creation failure never touches, resets, or force-pushes the delivery branch.

- **`setup` creates the Secret Manager secret container only, with no version** — same pattern as
  `ada-codex-api-key`.
- **`deploy-job` wires the private key at container start**, via
  `--set-secrets="...,ADA_GITHUB_APP_PRIVATE_KEY=ada-github-app-private-key:latest"` — never baked
  into the image, never in the Job's plain env-var config.
- **`ADA_GITHUB_APP_ID` / `ADA_GITHUB_APP_INSTALLATION_ID` are ordinary (non-secret) env vars**,
  set via `--set-env-vars` only when both are present in config — omitted entirely otherwise, so
  routine deploys are never blocked on this feature being configured.
- **Never print, persist, echo, or expose `ADA_GITHUB_APP_PRIVATE_KEY`** or the tokens minted from
  it. `githubAppCredential.ts` never logs the private key, the signed JWT, or the minted
  installation token; push failures surface only safe fields (a reason code and, where applicable,
  an HTTP status).
- Rotating the key: generate a new private key from the App's settings page, add it as a new secret
  version, and (optionally) delete the old key from GitHub's App settings once confirmed working —
  no `deploy-job` re-run required, same as Codex key rotation.
- Revoking access entirely: uninstall the App from the repository, or delete the App outright — the
  executor's next mint attempt then fails safely (a typed `token_exchange_failed` outcome).

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
- A GitHub App created, installed on `johnpwise/kanban-app`, and its private key added manually as
  a Secret Manager secret version — see "GitHub App delivery credential" above; without it, changed
  work still produces a verified local delivery commit, but the durable remote-publish step fails
  safely (`remoteDelivery: {status: "failed", reason: "credential_unavailable"}`) rather than
  blocking the rest of the execution
- The App additionally holding **Pull requests: Read and write** — see "Automatic Pull Request
  creation" above; not yet granted on the live App as of this writing. Without it, remote delivery
  still succeeds and verifies normally, but Pull Request creation fails safely
  (`pullRequest: {status: "failed", reason: "credential_unavailable" | "create_failed", ...}`)
  rather than blocking the rest of the execution or touching the delivery branch
