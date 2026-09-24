import { JobsClient } from "@google-cloud/run";

import { parseAdaCodexModelConfig } from "./adaCodexModelPolicy";
import {
  adaCodexModel,
  adaCodexReasoningEffort,
  adaGcpProjectId,
  adaGcpRegion,
  adaJobName,
} from "./adaExecutorRunLauncherConfig";

import type { LaunchAdaExecutorJob } from "./launchExecutionRun";

let jobsClient: JobsClient | undefined;

function getJobsClient(): JobsClient {
  jobsClient ??= new JobsClient();
  return jobsClient;
}

/**
 * Production `LaunchAdaExecutorJob`: requests one execution of the existing `ada-executor` Cloud
 * Run Job via the Cloud Run Admin API, overriding `ADA_EXECUTION_RUN_ID`, `CODEX_MODEL`, and (when
 * configured) `CODEX_REASONING_EFFORT` for that execution only. Authenticates via Application
 * Default Credentials — no stored credentials. Never updates the Job's persistent definition, and
 * never awaits the execution's completion: `runJob` resolves once Google Cloud accepts the
 * long-running launch request, not when the container finishes.
 *
 * The model configuration is validated (`parseAdaCodexModelConfig`) before `runJob` is called, so a
 * missing/unapproved model or reasoning effort fails closed without ever requesting a launch — this
 * mirrors PR #45's fail-closed intent in `executor/src/codexProviderConfig.ts` for the manual path.
 * A thrown `AdaCodexModelConfigError` is recognized by `launchExecutionRun.ts`'s
 * `classifyLaunchError` and acknowledged rather than retried.
 */
export const launchAdaExecutorJob: LaunchAdaExecutorJob = async ({ executionRequestId }) => {
  const { codexModel, codexReasoningEffort } = parseAdaCodexModelConfig({
    codexModel: adaCodexModel.value(),
    codexReasoningEffort: adaCodexReasoningEffort.value(),
  });

  const client = getJobsClient();
  const name = client.jobPath(adaGcpProjectId.value(), adaGcpRegion.value(), adaJobName.value());

  const env = [
    { name: "ADA_EXECUTION_RUN_ID", value: executionRequestId },
    { name: "CODEX_MODEL", value: codexModel },
    ...(codexReasoningEffort ? [{ name: "CODEX_REASONING_EFFORT", value: codexReasoningEffort }] : []),
  ];

  const [operation] = await client.runJob({
    name,
    overrides: {
      containerOverrides: [{ env }],
    },
  });

  return { operationName: operation.name };
};

/**
 * No-op stand-in for `launchAdaExecutorJob`, wired in only when running under the Firebase
 * Functions emulator (`FUNCTIONS_EMULATOR === "true"`, the same signal firebase-functions itself
 * uses). `executionRuns/{id}` is also written to by unrelated emulator-backed integration tests
 * for the Pub/Sub consumer; without this swap, those writes would trigger this real, Cloud-Run-
 * calling launcher in-process during test/local-dev runs. Never selected for a real deployment.
 */
export const launchAdaExecutorJobInEmulator: LaunchAdaExecutorJob = async ({ executionRequestId }) => {
  return { operationName: `emulator-noop:${executionRequestId}` };
};
