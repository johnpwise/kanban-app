import { JobsClient } from "@google-cloud/run";

import { adaGcpProjectId, adaGcpRegion } from "./adaExecutorRunLauncherConfig";
import { adaReleasePullRequestJobName } from "./adaReleasePullRequestControllerRunLauncherConfig";

import type { LaunchAdaReleasePullRequestControllerJob } from "./launchReleasePullRequestControl";

let jobsClient: JobsClient | undefined;

function getJobsClient(): JobsClient {
  jobsClient ??= new JobsClient();
  return jobsClient;
}

/**
 * Production `LaunchAdaReleasePullRequestControllerJob`: requests one execution of the separate
 * `ada-release-pr-controller` Cloud Run Job via the Cloud Run Admin API, overriding only
 * `ADA_RELEASE_INTENT_ID` for that execution — no `CODEX_*` configuration is ever propagated,
 * since the release-pull-request-controller runtime never invokes Codex (see
 * `executor/src/releasePullRequestControllerMain.ts`). Authenticates via Application Default
 * Credentials — no stored credentials. Never updates the Job's persistent definition, and never
 * awaits the execution's completion.
 */
export const launchAdaReleasePullRequestControllerJob: LaunchAdaReleasePullRequestControllerJob = async ({
  releaseIntentId,
}) => {
  const client = getJobsClient();
  const name = client.jobPath(adaGcpProjectId.value(), adaGcpRegion.value(), adaReleasePullRequestJobName.value());

  const [operation] = await client.runJob({
    name,
    overrides: {
      containerOverrides: [{ env: [{ name: "ADA_RELEASE_INTENT_ID", value: releaseIntentId }] }],
    },
  });

  return { operationName: operation.name };
};

/**
 * No-op stand-in for `launchAdaReleasePullRequestControllerJob`, wired in only when running under
 * the Firebase Functions emulator (`FUNCTIONS_EMULATOR === "true"`), for the same reason as the
 * other launchers' emulator no-ops: `releaseIntents/{id}` is also written to by unrelated
 * emulator-backed integration tests, and those writes must never reach the real Cloud Run Admin
 * API. Never selected for a real deployment.
 */
export const launchAdaReleasePullRequestControllerJobInEmulator: LaunchAdaReleasePullRequestControllerJob = async ({
  releaseIntentId,
}) => {
  return { operationName: `emulator-noop:${releaseIntentId}` };
};
