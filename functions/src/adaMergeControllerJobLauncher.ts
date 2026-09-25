import { JobsClient } from "@google-cloud/run";

import { adaGcpProjectId, adaGcpRegion } from "./adaExecutorRunLauncherConfig";
import { adaMergeJobName } from "./adaMergeControllerRunLauncherConfig";

import type { LaunchAdaMergeControllerJob } from "./launchAdaMergeControl";

let jobsClient: JobsClient | undefined;

function getJobsClient(): JobsClient {
  jobsClient ??= new JobsClient();
  return jobsClient;
}

/**
 * Production `LaunchAdaMergeControllerJob`: requests one execution of the separate
 * `ada-merge-controller` Cloud Run Job via the Cloud Run Admin API, overriding only
 * `ADA_EXECUTION_RUN_ID` for that execution — no `CODEX_*` configuration is ever propagated,
 * since the merge-controller runtime never invokes Codex (see
 * `executor/src/mergeControllerMain.ts`). Authenticates via Application Default Credentials — no
 * stored credentials. Never updates the Job's persistent definition, and never awaits the
 * execution's completion: `runJob` resolves once Google Cloud accepts the long-running launch
 * request, not when the container finishes.
 */
export const launchAdaMergeControllerJob: LaunchAdaMergeControllerJob = async ({ executionRequestId }) => {
  const client = getJobsClient();
  const name = client.jobPath(adaGcpProjectId.value(), adaGcpRegion.value(), adaMergeJobName.value());

  const [operation] = await client.runJob({
    name,
    overrides: {
      containerOverrides: [{ env: [{ name: "ADA_EXECUTION_RUN_ID", value: executionRequestId }] }],
    },
  });

  return { operationName: operation.name };
};

/**
 * No-op stand-in for `launchAdaMergeControllerJob`, wired in only when running under the Firebase
 * Functions emulator (`FUNCTIONS_EMULATOR === "true"`), for the same reason as
 * `launchAdaCiControllerJobInEmulator`: `executionRuns/{id}` is also written to by unrelated
 * emulator-backed integration tests, and those writes must never reach the real Cloud Run Admin
 * API. Never selected for a real deployment.
 */
export const launchAdaMergeControllerJobInEmulator: LaunchAdaMergeControllerJob = async ({ executionRequestId }) => {
  return { operationName: `emulator-noop:${executionRequestId}` };
};
