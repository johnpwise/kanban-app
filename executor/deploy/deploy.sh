#!/usr/bin/env bash
#
# Repeatable, idempotent provisioning for the ADA executor Cloud Run Job.
#
# This script only prepares/updates the execution *target* (Artifact Registry repo, runtime
# service account, IAM binding, container image, Cloud Run Job definition) and — via `execute` —
# runs one manual, explicitly-invoked execution. It never wires anything else to the Job: no
# Pub/Sub subscription, no Function, no scheduler. That remains a separate, later increment.
#
# Every subcommand is safe to run more than once: each performs a describe/exists check before
# creating or mutating a resource. Auth is always the operator's own `gcloud auth login` session
# (there is no service-account key stored in this repo).
#
# Usage:
#   deploy.sh setup            # one-time: enable APIs, create AR repo + runtime SA, bind IAM
#   deploy.sh build            # build the executor image (docker if available, else Cloud Build)
#                               # and push it to Artifact Registry, tagged with the git commit SHA
#   deploy.sh deploy-job       # create or update the Cloud Run Job to use the most recently built
#                               # image (ADA_EXECUTION_RUN_ID/CODEX_MODEL/CODEX_REASONING_EFFORT are
#                               # intentionally left unset here — supplied per execution instead)
#   deploy.sh deploy-ci-controller-job
#                               # create or update the separate ada-ci-controller Cloud Run Job:
#                               # same image as deploy-job, overridden to run
#                               # `node lib/ciControllerMain.js` instead of the image's default
#                               # command. No CODEX_API_KEY secret is wired (this runtime never
#                               # invokes Codex); the GitHub App private-key secret is reused.
#                               # ADA_EXECUTION_RUN_ID is left unset here too — supplied per
#                               # execution by the Functions launcher
#                               # (functions/src/adaCiControllerJobLauncher.ts).
#   deploy.sh deploy-merge-controller-job
#                               # create or update the separate ada-merge-controller Cloud Run Job:
#                               # same image as deploy-job, overridden to run
#                               # `node lib/mergeControllerMain.js` instead of the image's default
#                               # command. No CODEX_API_KEY secret is wired (this runtime never
#                               # invokes Codex); the GitHub App private-key secret is reused.
#                               # ADA_EXECUTION_RUN_ID is left unset here too — supplied per
#                               # execution by the Functions launcher
#                               # (functions/src/adaMergeControllerJobLauncher.ts).
#   deploy.sh execute <runId> <codexModel> [reasoningEffort]
#                               # run the Job once, overriding ADA_EXECUTION_RUN_ID, CODEX_MODEL, and
#                               # (if given) CODEX_REASONING_EFFORT for that execution only — the
#                               # Job's stored definition is not modified. codexModel must be one of
#                               # ALLOWED_CODEX_MODELS below; reasoningEffort (optional) must be one
#                               # of ALLOWED_CODEX_REASONING_EFFORTS.
#
# Configuration: see config.env.example. Copy to config.env (gitignored) or export the same names.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXECUTOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  echo "Usage: $0 {setup|build|deploy-job|deploy-ci-controller-job|deploy-merge-controller-job|execute <executionRunId> <codexModel> [reasoningEffort]}" >&2
}

# The only Codex models/effort levels currently approved for ADA executor runs. Extend these
# arrays (and executor/src/codexProviderConfig.ts's CODEX_REASONING_EFFORT_VALUES, which also
# accepts xhigh/max) when a new model or effort level is approved for use.
ALLOWED_CODEX_MODELS=("gpt-5.6-luna" "gpt-5.6-terra")
ALLOWED_CODEX_REASONING_EFFORTS=("low" "medium" "high")

case "${1:-}" in
setup | build | deploy-job | deploy-ci-controller-job | deploy-merge-controller-job | execute) ;;
*)
  usage
  exit 1
  ;;
esac

if [[ -f "$SCRIPT_DIR/config.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

: "${ADA_GCP_PROJECT_ID:?Set ADA_GCP_PROJECT_ID (see config.env.example)}"
: "${ADA_GCP_REGION:?Set ADA_GCP_REGION (see config.env.example)}"
: "${ADA_ARTIFACT_REPO:?Set ADA_ARTIFACT_REPO (see config.env.example)}"
: "${ADA_IMAGE_NAME:?Set ADA_IMAGE_NAME (see config.env.example)}"
: "${ADA_JOB_NAME:?Set ADA_JOB_NAME (see config.env.example)}"
: "${ADA_CI_JOB_NAME:?Set ADA_CI_JOB_NAME (see config.env.example)}"
: "${ADA_MERGE_JOB_NAME:?Set ADA_MERGE_JOB_NAME (see config.env.example)}"
: "${ADA_RUNTIME_SERVICE_ACCOUNT:?Set ADA_RUNTIME_SERVICE_ACCOUNT (see config.env.example)}"
: "${ADA_CODEX_API_KEY_SECRET:?Set ADA_CODEX_API_KEY_SECRET (see config.env.example)}"
: "${ADA_GITHUB_APP_PRIVATE_KEY_SECRET:?Set ADA_GITHUB_APP_PRIVATE_KEY_SECRET (see config.env.example)}"

PROJECT_ID="$ADA_GCP_PROJECT_ID"
REGION="$ADA_GCP_REGION"
ARTIFACT_REPO="$ADA_ARTIFACT_REPO"
IMAGE_NAME="$ADA_IMAGE_NAME"
JOB_NAME="$ADA_JOB_NAME"
CI_JOB_NAME="$ADA_CI_JOB_NAME"
MERGE_JOB_NAME="$ADA_MERGE_JOB_NAME"
RUNTIME_SA="$ADA_RUNTIME_SERVICE_ACCOUNT"
CODEX_SECRET_NAME="$ADA_CODEX_API_KEY_SECRET"
GITHUB_APP_PRIVATE_KEY_SECRET_NAME="$ADA_GITHUB_APP_PRIVATE_KEY_SECRET"
# Not secrets (visible on the GitHub App's own settings/installation pages) — only known after the
# separate manual step of creating and installing the App (see "GitHub App delivery credential" in
# deploy/README.md). Left unset, `deploy-job` omits them and the durable-push step fails safely at
# the (typed) credential-config-invalid outcome rather than blocking unrelated deploys.
GITHUB_APP_ID="${ADA_GITHUB_APP_ID:-}"
GITHUB_APP_INSTALLATION_ID="${ADA_GITHUB_APP_INSTALLATION_ID:-}"
LAST_IMAGE_FILE="$SCRIPT_DIR/.last-image"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

image_tag() {
  if [[ -n "${ADA_IMAGE_TAG:-}" ]]; then
    printf '%s' "$ADA_IMAGE_TAG"
  else
    (cd "$EXECUTOR_DIR" && git rev-parse --short HEAD)
  fi
}

image_ref() {
  printf '%s-docker.pkg.dev/%s/%s/%s:%s' \
    "$REGION" "$PROJECT_ID" "$ARTIFACT_REPO" "$IMAGE_NAME" "$(image_tag)"
}

cmd_setup() {
  require_cmd gcloud

  echo "==> Enabling required APIs (no-op if already enabled)"
  gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    iam.googleapis.com \
    cloudbuild.googleapis.com \
    secretmanager.googleapis.com \
    --project="$PROJECT_ID"

  echo "==> Ensuring Artifact Registry repo '$ARTIFACT_REPO' exists in $REGION"
  if gcloud artifacts repositories describe "$ARTIFACT_REPO" \
    --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1; then
    echo "    already exists, skipping create"
  else
    gcloud artifacts repositories create "$ARTIFACT_REPO" \
      --project="$PROJECT_ID" \
      --location="$REGION" \
      --repository-format=docker \
      --description="ADA executor container images"
  fi

  echo "==> Ensuring Cloud Build's default service account can push into '$ARTIFACT_REPO'"
  echo "    (scoped to this one repo, not project-wide — needed because local Docker is"
  echo "    unavailable, so 'build' uses Cloud Build as the fallback build mechanism)"
  local project_number
  project_number="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
  gcloud artifacts repositories add-iam-policy-binding "$ARTIFACT_REPO" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --member="serviceAccount:${project_number}@cloudbuild.gserviceaccount.com" \
    --role="roles/artifactregistry.writer" \
    >/dev/null

  local sa_id="${RUNTIME_SA%%@*}"
  echo "==> Ensuring runtime service account '$RUNTIME_SA' exists"
  if gcloud iam service-accounts describe "$RUNTIME_SA" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "    already exists, skipping create"
  else
    gcloud iam service-accounts create "$sa_id" \
      --project="$PROJECT_ID" \
      --display-name="ADA Executor Runtime"
  fi

  echo "==> Ensuring '$RUNTIME_SA' has roles/datastore.user (read/write Firestore, project-level"
  echo "    is the finest grain Firestore IAM supports) — add-iam-policy-binding is idempotent."
  echo "    Upgraded from roles/datastore.viewer: the executor's atomic claim (see"
  echo "    executor/src/executionRunRepository.ts) now performs one conditional Firestore write"
  echo "    per run via a transaction. This is a live permission increase — do not re-run 'setup'"
  echo "    against a real project without separate explicit approval for that change."
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/datastore.user" \
    --condition=None \
    >/dev/null

  echo "==> Ensuring Secret Manager secret '$CODEX_SECRET_NAME' exists (empty — this script never"
  echo "    reads, writes, or holds the real Codex API key value; see 'Codex CLI authentication'"
  echo "    in deploy/README.md for the one manual step that adds the actual secret version)"
  if gcloud secrets describe "$CODEX_SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "    already exists, skipping create"
  else
    gcloud secrets create "$CODEX_SECRET_NAME" \
      --project="$PROJECT_ID" \
      --replication-policy="automatic"
  fi

  echo "==> Ensuring '$RUNTIME_SA' can access '$CODEX_SECRET_NAME' only (roles/secretmanager.secretAccessor,"
  echo "    scoped to this one secret, not project-wide)"
  gcloud secrets add-iam-policy-binding "$CODEX_SECRET_NAME" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor" \
    >/dev/null

  echo "==> Ensuring Secret Manager secret '$GITHUB_APP_PRIVATE_KEY_SECRET_NAME' exists (empty — this"
  echo "    script never reads, writes, or holds the real GitHub App private key; see 'GitHub App"
  echo "    delivery credential' in deploy/README.md for the manual steps that create the App and"
  echo "    add the actual key)"
  if gcloud secrets describe "$GITHUB_APP_PRIVATE_KEY_SECRET_NAME" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "    already exists, skipping create"
  else
    gcloud secrets create "$GITHUB_APP_PRIVATE_KEY_SECRET_NAME" \
      --project="$PROJECT_ID" \
      --replication-policy="automatic"
  fi

  echo "==> Ensuring '$RUNTIME_SA' can access '$GITHUB_APP_PRIVATE_KEY_SECRET_NAME' only"
  echo "    (roles/secretmanager.secretAccessor, scoped to this one secret, not project-wide)"
  gcloud secrets add-iam-policy-binding "$GITHUB_APP_PRIVATE_KEY_SECRET_NAME" \
    --project="$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor" \
    >/dev/null

  echo "==> Setup complete."
}

cmd_build() {
  require_cmd gcloud
  local image
  image="$(image_ref)"

  if command -v docker >/dev/null 2>&1; then
    echo "==> Building $image with local Docker"
    docker build -t "$image" "$EXECUTOR_DIR"
    echo "==> Configuring Docker auth for $REGION-docker.pkg.dev"
    gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet --project="$PROJECT_ID"
    echo "==> Pushing $image"
    docker push "$image"
  else
    echo "==> Docker not found locally; building via Cloud Build instead"
    gcloud builds submit "$EXECUTOR_DIR" --tag="$image" --project="$PROJECT_ID"
  fi

  printf '%s' "$image" >"$LAST_IMAGE_FILE"
  echo "==> Built and pushed: $image"
}

cmd_deploy_job() {
  require_cmd gcloud
  local image
  if [[ -f "$LAST_IMAGE_FILE" ]]; then
    image="$(cat "$LAST_IMAGE_FILE")"
  else
    image="$(image_ref)"
    echo "==> No recorded build from this session; assuming already-pushed image: $image"
  fi

  echo "==> Deploying (create-or-update) Cloud Run Job '$JOB_NAME' in $REGION with image $image"
  echo "    ADA_EXECUTION_RUN_ID is intentionally NOT set here — it is supplied per execution."
  echo "    CODEX_API_KEY and ADA_GITHUB_APP_PRIVATE_KEY are populated from Secret Manager at"
  echo "    container start (--set-secrets), so neither real value ever appears in this script, in"
  echo "    config.env, in the Job's own plain env-var config, or in Cloud Logging."

  local deploy_args=(
    "$JOB_NAME"
    --image="$image"
    --region="$REGION"
    --project="$PROJECT_ID"
    --tasks=1
    --max-retries=0
    --service-account="$RUNTIME_SA"
    --set-secrets="CODEX_API_KEY=${CODEX_SECRET_NAME}:latest,ADA_GITHUB_APP_PRIVATE_KEY=${GITHUB_APP_PRIVATE_KEY_SECRET_NAME}:latest"
  )

  if [[ -n "$GITHUB_APP_ID" && -n "$GITHUB_APP_INSTALLATION_ID" ]]; then
    echo "    ADA_GITHUB_APP_ID / ADA_GITHUB_APP_INSTALLATION_ID set from config (not secrets)."
    deploy_args+=(--set-env-vars="ADA_GITHUB_APP_ID=${GITHUB_APP_ID},ADA_GITHUB_APP_INSTALLATION_ID=${GITHUB_APP_INSTALLATION_ID}")
  else
    echo "    ADA_GITHUB_APP_ID / ADA_GITHUB_APP_INSTALLATION_ID not set — the GitHub App has not"
    echo "    been created/installed yet (see 'GitHub App delivery credential' in deploy/README.md)."
    echo "    Deploying without them: the durable-push step will fail safely (typed"
    echo "    'config_invalid' outcome) without blocking the rest of this deploy."
  fi

  gcloud run jobs deploy "${deploy_args[@]}"

  echo "==> Job deployed."
}

cmd_deploy_ci_controller_job() {
  require_cmd gcloud
  local image
  if [[ -f "$LAST_IMAGE_FILE" ]]; then
    image="$(cat "$LAST_IMAGE_FILE")"
  else
    image="$(image_ref)"
    echo "==> No recorded build from this session; assuming already-pushed image: $image"
  fi

  echo "==> Deploying (create-or-update) Cloud Run Job '$CI_JOB_NAME' in $REGION with image $image"
  echo "    Same image as '$JOB_NAME', overridden to run 'node lib/ciControllerMain.js' instead of"
  echo "    the image's default command — this runtime never invokes Codex, so no CODEX_API_KEY"
  echo "    secret is wired here. ADA_EXECUTION_RUN_ID is intentionally NOT set here — it is"
  echo "    supplied per execution by the Functions launcher (adaCiControllerJobLauncher.ts)."
  echo "    ADA_GITHUB_APP_PRIVATE_KEY is populated from Secret Manager at container start"
  echo "    (--set-secrets), reusing the same secret as '$JOB_NAME' — so the real key value never"
  echo "    appears in this script, in config.env, in the Job's own plain env-var config, or in"
  echo "    Cloud Logging."
  echo "    --task-timeout=1800s (30 minutes): sized to safely contain the bounded observation"
  echo "    policy in executor/src/ciControllerMain.ts (worst case ~27 minutes of idle waiting"
  echo "    across 55 observations at a 30s delay, plus GitHub API round-trip time per attempt) —"
  echo "    see that file's own comment for the full rationale against .github/workflows/ci.yml's"
  echo "    typical job durations."

  local deploy_args=(
    "$CI_JOB_NAME"
    --image="$image"
    --command=node
    --args=lib/ciControllerMain.js
    --region="$REGION"
    --project="$PROJECT_ID"
    --tasks=1
    --max-retries=0
    --task-timeout=1800s
    --service-account="$RUNTIME_SA"
    --set-secrets="ADA_GITHUB_APP_PRIVATE_KEY=${GITHUB_APP_PRIVATE_KEY_SECRET_NAME}:latest"
  )

  if [[ -n "$GITHUB_APP_ID" && -n "$GITHUB_APP_INSTALLATION_ID" ]]; then
    echo "    ADA_GITHUB_APP_ID / ADA_GITHUB_APP_INSTALLATION_ID set from config (not secrets)."
    deploy_args+=(--set-env-vars="ADA_GITHUB_APP_ID=${GITHUB_APP_ID},ADA_GITHUB_APP_INSTALLATION_ID=${GITHUB_APP_INSTALLATION_ID}")
  else
    echo "    ADA_GITHUB_APP_ID / ADA_GITHUB_APP_INSTALLATION_ID not set — the GitHub App has not"
    echo "    been created/installed yet (see 'GitHub App delivery credential' in deploy/README.md)."
    echo "    Deploying without them: CI observation will fail safely (typed 'config_invalid'"
    echo "    credential outcome) without blocking the rest of this deploy."
  fi

  gcloud run jobs deploy "${deploy_args[@]}"

  echo "==> Job deployed."
}

cmd_deploy_merge_controller_job() {
  require_cmd gcloud
  local image
  if [[ -f "$LAST_IMAGE_FILE" ]]; then
    image="$(cat "$LAST_IMAGE_FILE")"
  else
    image="$(image_ref)"
    echo "==> No recorded build from this session; assuming already-pushed image: $image"
  fi

  echo "==> Deploying (create-or-update) Cloud Run Job '$MERGE_JOB_NAME' in $REGION with image $image"
  echo "    Same image as '$JOB_NAME', overridden to run 'node lib/mergeControllerMain.js' instead of"
  echo "    the image's default command — this runtime never invokes Codex, so no CODEX_API_KEY"
  echo "    secret is wired here. ADA_EXECUTION_RUN_ID is intentionally NOT set here — it is"
  echo "    supplied per execution by the Functions launcher (adaMergeControllerJobLauncher.ts)."
  echo "    ADA_GITHUB_APP_PRIVATE_KEY is populated from Secret Manager at container start"
  echo "    (--set-secrets), reusing the same secret as '$JOB_NAME' — so the real key value never"
  echo "    appears in this script, in config.env, in the Job's own plain env-var config, or in"
  echo "    Cloud Logging."
  echo "    --task-timeout=120s: sized to safely contain the bounded mergeability-pending retry"
  echo "    policy in executor/src/mergeControllerMain.ts (worst case ~27s of idle waiting across"
  echo "    10 attempts at a 3s delay, plus GitHub API round-trip time per attempt) — see that"
  echo "    file's own comment for the full rationale."

  local deploy_args=(
    "$MERGE_JOB_NAME"
    --image="$image"
    --command=node
    --args=lib/mergeControllerMain.js
    --region="$REGION"
    --project="$PROJECT_ID"
    --tasks=1
    --max-retries=0
    --task-timeout=120s
    --service-account="$RUNTIME_SA"
    --set-secrets="ADA_GITHUB_APP_PRIVATE_KEY=${GITHUB_APP_PRIVATE_KEY_SECRET_NAME}:latest"
  )

  if [[ -n "$GITHUB_APP_ID" && -n "$GITHUB_APP_INSTALLATION_ID" ]]; then
    echo "    ADA_GITHUB_APP_ID / ADA_GITHUB_APP_INSTALLATION_ID set from config (not secrets)."
    deploy_args+=(--set-env-vars="ADA_GITHUB_APP_ID=${GITHUB_APP_ID},ADA_GITHUB_APP_INSTALLATION_ID=${GITHUB_APP_INSTALLATION_ID}")
  else
    echo "    ADA_GITHUB_APP_ID / ADA_GITHUB_APP_INSTALLATION_ID not set — the GitHub App has not"
    echo "    been created/installed yet (see 'GitHub App delivery credential' in deploy/README.md)."
    echo "    Deploying without them: merge-eligibility observation will fail safely (typed"
    echo "    'config_invalid' credential outcome) without blocking the rest of this deploy."
  fi

  gcloud run jobs deploy "${deploy_args[@]}"

  echo "==> Job deployed."
}

contains_value() {
  local needle="$1"
  shift
  local candidate
  for candidate in "$@"; do
    if [[ "$candidate" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

cmd_execute() {
  require_cmd gcloud
  local run_id="${1:?Usage: deploy.sh execute <executionRunId> <codexModel> [reasoningEffort]}"
  local codex_model="${2:?Usage: deploy.sh execute <executionRunId> <codexModel> [reasoningEffort]}"
  local reasoning_effort="${3:-}"

  if ! contains_value "$codex_model" "${ALLOWED_CODEX_MODELS[@]}"; then
    echo "error: codexModel must be one of: ${ALLOWED_CODEX_MODELS[*]} (got '$codex_model')" >&2
    exit 1
  fi

  local env_vars="ADA_EXECUTION_RUN_ID=$run_id,CODEX_MODEL=$codex_model"
  if [[ -n "$reasoning_effort" ]]; then
    if ! contains_value "$reasoning_effort" "${ALLOWED_CODEX_REASONING_EFFORTS[@]}"; then
      echo "error: reasoningEffort must be one of: ${ALLOWED_CODEX_REASONING_EFFORTS[*]} (got '$reasoning_effort')" >&2
      exit 1
    fi
    env_vars="$env_vars,CODEX_REASONING_EFFORT=$reasoning_effort"
  fi

  echo "==> Executing Cloud Run Job '$JOB_NAME' once, with $env_vars"
  echo "    as a per-execution override only — confirmed live (see"
  echo "    .agent-workflows/ada-executor-repository-checkout-live-validation/step-009.md) that"
  echo "    this does not modify the Job's stored definition."
  gcloud run jobs execute "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --update-env-vars="$env_vars" \
    --wait
}

case "$1" in
setup) cmd_setup ;;
build) cmd_build ;;
deploy-job) cmd_deploy_job ;;
deploy-ci-controller-job) cmd_deploy_ci_controller_job ;;
deploy-merge-controller-job) cmd_deploy_merge_controller_job ;;
execute) cmd_execute "${2:-}" "${3:-}" "${4:-}" ;;
esac
