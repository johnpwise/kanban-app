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
#                               # image (ADA_EXECUTION_RUN_ID is intentionally left unset here)
#   deploy.sh execute <runId>  # run the Job once, overriding ADA_EXECUTION_RUN_ID for that
#                               # execution only — the Job's stored definition is not modified
#
# Configuration: see config.env.example. Copy to config.env (gitignored) or export the same names.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXECUTOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
  echo "Usage: $0 {setup|build|deploy-job|execute <executionRunId>}" >&2
}

case "${1:-}" in
setup | build | deploy-job | execute) ;;
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
: "${ADA_RUNTIME_SERVICE_ACCOUNT:?Set ADA_RUNTIME_SERVICE_ACCOUNT (see config.env.example)}"

PROJECT_ID="$ADA_GCP_PROJECT_ID"
REGION="$ADA_GCP_REGION"
ARTIFACT_REPO="$ADA_ARTIFACT_REPO"
IMAGE_NAME="$ADA_IMAGE_NAME"
JOB_NAME="$ADA_JOB_NAME"
RUNTIME_SA="$ADA_RUNTIME_SERVICE_ACCOUNT"
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

  echo "==> Ensuring '$RUNTIME_SA' has roles/datastore.viewer (read-only Firestore, project-level"
  echo "    is the finest grain Firestore IAM supports) — add-iam-policy-binding is idempotent"
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$RUNTIME_SA" \
    --role="roles/datastore.viewer" \
    --condition=None \
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
  gcloud run jobs deploy "$JOB_NAME" \
    --image="$image" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --tasks=1 \
    --max-retries=0 \
    --service-account="$RUNTIME_SA"

  echo "==> Job deployed."
}

cmd_execute() {
  require_cmd gcloud
  local run_id="${1:?Usage: deploy.sh execute <executionRunId>}"

  echo "==> Executing Cloud Run Job '$JOB_NAME' once, with ADA_EXECUTION_RUN_ID=$run_id"
  echo "    as a per-execution override only (verify --update-env-vars overrides-only semantics"
  echo "    against your installed gcloud version's 'gcloud run jobs execute --help' before"
  echo "    relying on this — the Job's stored definition must remain unchanged after this runs)."
  gcloud run jobs execute "$JOB_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --update-env-vars="ADA_EXECUTION_RUN_ID=$run_id" \
    --wait
}

case "$1" in
setup) cmd_setup ;;
build) cmd_build ;;
deploy-job) cmd_deploy_job ;;
execute) cmd_execute "${2:-}" ;;
esac
