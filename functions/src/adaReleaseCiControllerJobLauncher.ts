import { JobsClient } from "@google-cloud/run";

import { adaGcpProjectId, adaGcpRegion } from "./adaExecutorRunLauncherConfig";
import { adaReleaseCiJobName } from "./adaReleaseCiControllerRunLauncherConfig";

import type { LaunchAdaReleaseCiControllerJob } from "./launchReleaseCiControl";

let jobsClient: JobsClient | undefined;

function getJobsClient(): JobsClient {
  jobsClient ??= new JobsClient();
  return jobsClient;
}

/**
 * Production `LaunchAdaReleaseCiControllerJob`: requests one execution of the separate
 * `ada-release-ci-controller` Cloud Run Job via the Cloud Run Admin API, overriding only
 * `ADA_RELEASE_INTENT_ID` for that execution — no `CODEX_*` configuration is ever propagated, since
 * the release-ci-controller runtime never invokes Codex (see
 * `executor/src/releaseCiControllerMain.ts`). Authenticates via Application Default Credentials —
 * no stored credentials. Never updates the Job's persistent definition, and never awaits the
 * execution's completion.
 */
export const launchAdaReleaseCiControllerJob: LaunchAdaReleaseCiControllerJob = async ({ releaseIntentId }) => {
  const client = getJobsClient();
  const name = client.jobPath(adaGcpProjectId.value(), adaGcpRegion.value(), adaReleaseCiJobName.value());

  const [operation] = await client.runJob({
    name,
    overrides: {
      containerOverrides: [{ env: [{ name: "ADA_RELEASE_INTENT_ID", value: releaseIntentId }] }],
    },
  });

  return { operationName: operation.name };
};

/**
 * No-op stand-in for `launchAdaReleaseCiControllerJob`, wired in only when running under the
 * Firebase Functions emulator (`FUNCTIONS_EMULATOR === "true"`), for the same reason as the other
 * launchers' emulator no-ops: `releaseIntents/{id}` is also written to by unrelated emulator-backed
 * integration tests, and those writes must never reach the real Cloud Run Admin API. Never selected
 * for a real deployment.
 */
export const launchAdaReleaseCiControllerJobInEmulator: LaunchAdaReleaseCiControllerJob = async ({
  releaseIntentId,
}) => {
  return { operationName: `emulator-noop:${releaseIntentId}` };
};
